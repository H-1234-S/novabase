import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as bcrypt from 'bcrypt';
import { eq, sql } from 'drizzle-orm';
import { DrizzleService } from '../db/drizzle.service.js';
import { projects } from '../db/schema/index.js';
import { AUTH_PROVIDERS, MAGIC_LINK_EXPIRES_IN } from '@novabase/constants';
import type { SignUpInput, SignInInput } from '@novabase/types';

interface ProjectAuthTokenPayload {
  sub: string;
  email: string;
  projectId: string;
}

@Injectable()
export class ProjectAuthService {
  // TODO
  private resend: Resend;

  constructor(
    private drizzle: DrizzleService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
  }

  private async getProject(projectSlug: string) {
    const [project] = await this.drizzle.db
      .select()
      .from(projects)
      .where(eq(projects.slug, projectSlug))
      .limit(1);

    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  // 懒建表
  // 并非每个项目都需要认证
  private async ensureAuthUsersTable(dbSchema: string): Promise<void> {
    // 项目如果从不使用认证，就不会产生 auth_users 表
    await this.drizzle.db.execute(
      sql.raw(`
      CREATE TABLE IF NOT EXISTS "${dbSchema}"."auth_users" (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        provider TEXT NOT NULL DEFAULT 'email',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `),
    );
  }

  private signToken(
    userId: string,
    email: string,
    projectId: string,
    // authJwtSecret
    secret: string,
  ): string {
    return this.jwtService.sign(
      { sub: userId, email, projectId } satisfies ProjectAuthTokenPayload,
      { secret, expiresIn: '7d' },
    );
  }

  // 注册逻辑
  async signUp(projectSlug: string, dto: SignUpInput) {
    const project = await this.getProject(projectSlug);
    await this.ensureAuthUsersTable(project.dbSchema);

    // 判断该 email 有无被使用
    // sql.identifier() 不是字符串拼接，是为了防 SQL 注入
    const existing = await this.drizzle.db.execute<{ id: string }>(sql`
      SELECT id FROM ${sql.identifier(project.dbSchema)}.auth_users
      WHERE email = ${dto.email}
    `);

    if (existing.rows.length > 0) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    // 插入用户信息
    const result = await this.drizzle.db.execute<{
      id: string;
      email: string;
    }>(sql`
      INSERT INTO ${sql.identifier(project.dbSchema)}.auth_users
        (email, password_hash, provider)
      VALUES (${dto.email}, ${passwordHash}, ${AUTH_PROVIDERS.EMAIL})
      RETURNING id, email
    `);

    const user = result.rows[0];

    // ？？？
    const accessToken = this.signToken(
      user.id,
      user.email,
      project.id,
      project.authJwtSecret,
    );

    return { user: { id: user.id, email: user.email }, accessToken };
  }

  async signIn(projectSlug: string, dto: SignInInput) {
    const project = await this.getProject(projectSlug);
    await this.ensureAuthUsersTable(project.dbSchema);

    const result = await this.drizzle.db.execute<{
      id: string;
      email: string;
      password_hash: string | null;
    }>(sql`
      SELECT id, email, password_hash
      FROM ${sql.identifier(project.dbSchema)}.auth_users
      WHERE email = ${dto.email}
    `);

    const user = result.rows[0];

    // 作用于 OAuth 用户
    if (!user?.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const match = await bcrypt.compare(dto.password, user.password_hash);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.signToken(
      user.id,
      user.email,
      project.id,
      project.authJwtSecret,
    );

    return { user: { id: user.id, email: user.email }, accessToken };
  }

  // 发送魔法链接？ 邀请注册？
  async sendMagicLink(projectSlug: string, email: string) {
    const project = await this.getProject(projectSlug);
    await this.ensureAuthUsersTable(project.dbSchema);

    const existing = await this.drizzle.db.execute<{ id: string }>(sql`
      SELECT id FROM ${sql.identifier(project.dbSchema)}.auth_users
      WHERE email = ${email}
    `);

    if (existing.rows.length === 0) {
      await this.drizzle.db.execute(sql`
        INSERT INTO ${sql.identifier(project.dbSchema)}.auth_users
          (email, provider, email_verified)
        VALUES (${email}, ${AUTH_PROVIDERS.EMAIL}, true)
      `);
    }

    const linkToken = this.jwtService.sign(
      { email, projectId: project.id },
      { secret: project.authJwtSecret, expiresIn: MAGIC_LINK_EXPIRES_IN },
    );

    const apiUrl = this.configService.get<string>('API_URL');
    const magicLinkUrl = `${apiUrl}/projects/${projectSlug}/auth/magic-link/verify?token=${linkToken}`;

    await this.resend.emails.send({
      from: 'Novabase <onboarding@resend.dev>',
      to: email,
      subject: 'Your magic link',
      html: `
        <p>Click to sign in (expires in 15 minutes):</p>
        <a href="${magicLinkUrl}">Sign in</a>
      `,
    });

    return { message: 'Magic link sent' };
  }

  async verifyMagicLink(projectSlug: string, token: string) {
    const project = await this.getProject(projectSlug);

    let payload: { email: string; projectId: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: project.authJwtSecret,
      });
    } catch {
      throw new BadRequestException('Invalid or expired magic link');
    }

    const result = await this.drizzle.db.execute<{ id: string; email: string }>(
      sql`
        SELECT id, email FROM ${sql.identifier(project.dbSchema)}.auth_users
        WHERE email = ${payload.email}
      `,
    );

    const user = result.rows[0];
    if (!user) throw new NotFoundException('User not found');

    const accessToken = this.signToken(
      user.id,
      user.email,
      project.id,
      project.authJwtSecret,
    );

    return { user: { id: user.id, email: user.email }, accessToken };
  }

  buildGoogleAuthUrl(clientId: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  buildGithubAuthUrl(clientId: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'user:email',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async handleGoogleCallback(projectSlug: string, code: string) {
    const project = await this.getProject(projectSlug);
    await this.ensureAuthUsersTable(project.dbSchema);

    if (!project.googleClientId || !project.googleClientSecret) {
      throw new BadRequestException(
        'Google OAuth not configured for this project',
      );
    }

    const apiUrl = this.configService.get<string>('API_URL');
    const redirectUri = `${apiUrl}/projects/${projectSlug}/auth/google/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: project.googleClientId,
        client_secret: project.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );

    const profile = (await profileRes.json()) as { email: string };
    return this.findOrCreateOAuthUser(
      project,
      profile.email,
      AUTH_PROVIDERS.GOOGLE,
    );
  }

  async handleGithubCallback(projectSlug: string, code: string) {
    const project = await this.getProject(projectSlug);
    await this.ensureAuthUsersTable(project.dbSchema);

    if (!project.githubClientId || !project.githubClientSecret) {
      throw new BadRequestException(
        'GitHub OAuth not configured for this project',
      );
    }

    const apiUrl = this.configService.get<string>('API_URL');
    const redirectUri = `${apiUrl}/projects/${projectSlug}/auth/github/callback`;

    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: project.githubClientId,
          client_secret: project.githubClientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      },
    );

    const tokenData = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    const emails = (await profileRes.json()) as Array<{
      email: string;
      primary: boolean;
    }>;

    const primary = emails.find((e) => e.primary) ?? emails[0];
    if (!primary?.email) {
      throw new BadRequestException('Could not read email from GitHub');
    }

    return this.findOrCreateOAuthUser(
      project,
      primary.email,
      AUTH_PROVIDERS.GITHUB,
    );
  }

  private async findOrCreateOAuthUser(
    project: typeof projects.$inferSelect,
    email: string,
    provider: string,
  ) {
    const existing = await this.drizzle.db.execute<{
      id: string;
      email: string;
    }>(
      sql`
        SELECT id, email FROM ${sql.identifier(project.dbSchema)}.auth_users
        WHERE email = ${email}
      `,
    );

    let user = existing.rows[0];

    if (!user) {
      const result = await this.drizzle.db.execute<{
        id: string;
        email: string;
      }>(
        sql`
          INSERT INTO ${sql.identifier(project.dbSchema)}.auth_users
            (email, provider, email_verified)
          VALUES (${email}, ${provider}, true)
          RETURNING id, email
        `,
      );
      user = result.rows[0];
    }

    const accessToken = this.signToken(
      user.id,
      user.email,
      project.id,
      project.authJwtSecret,
    );

    return { user: { id: user.id, email: user.email }, accessToken };
  }

  async getUsers(projectSlug: string) {
    const project = await this.getProject(projectSlug);
    await this.ensureAuthUsersTable(project.dbSchema);

    const result = await this.drizzle.db.execute<{
      id: string;
      email: string;
      email_verified: boolean;
      provider: string;
      created_at: string;
    }>(sql`
      SELECT id, email, email_verified, provider, created_at
      FROM ${sql.identifier(project.dbSchema)}.auth_users
      ORDER BY created_at DESC
    `);

    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified,
      provider: row.provider,
      createdAt: row.created_at,
    }));
  }

  async getOAuthSettings(projectSlug: string) {
    const project = await this.getProject(projectSlug);
    return {
      siteUrl: project.siteUrl,
      googleClientId: project.googleClientId,
      googleClientSecret: project.googleClientSecret,
      githubClientId: project.githubClientId,
      githubClientSecret: project.githubClientSecret,
    };
  }

  resolveSiteUrl(project: typeof projects.$inferSelect): string {
    return (
      project.siteUrl ??
      this.configService.get<string>('WEB_URL') ??
      'http://localhost:3001'
    );
  }

  async getSiteUrlForProject(projectSlug: string): Promise<string> {
    const project = await this.getProject(projectSlug);
    return this.resolveSiteUrl(project);
  }

  async updateOAuthSettings(
    projectSlug: string,
    settings: {
      siteUrl?: string;
      googleClientId?: string;
      googleClientSecret?: string;
      githubClientId?: string;
      githubClientSecret?: string;
    },
  ) {
    const project = await this.getProject(projectSlug);

    const [updated] = await this.drizzle.db
      .update(projects)
      .set(settings)
      .where(eq(projects.id, project.id))
      .returning();

    return updated;
  }
}
