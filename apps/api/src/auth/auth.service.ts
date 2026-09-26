import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import slugify from 'slugify';
import { eq } from 'drizzle-orm';
import { COOKIE_KEYS } from '@novabase/constants';
import { JwtPayload } from '@novabase/types';
import { users, organizations, orgMembers } from '../db/schema/index.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { DrizzleService } from '../db/drizzle.service.js';

@Injectable()
export class AuthService {
  constructor(
    private drizzle: DrizzleService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // Cookie helpers
  setTokenCookies(
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    res.cookie(COOKIE_KEYS.ACCESS_TOKEN, tokens.accessToken, {
      // 禁止 JS 读取
      httpOnly: true,
      secure: isProduction,
      // 防止 CSRF 攻击
      // lax 只在顶级导航且是安全方法 GET
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie(COOKIE_KEYS.REFRESH_TOKEN, tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  clearTokenCookies(res: Response) {
    res.clearCookie(COOKIE_KEYS.ACCESS_TOKEN);
    res.clearCookie(COOKIE_KEYS.REFRESH_TOKEN);
  }

  // Slug helper
  private generateOrgSlug(name: string): string {
    const base = slugify(`${name}-org`, { lower: true, strict: true });
    const suffix = randomBytes(3).toString('hex');
    return `${base}-${suffix}`;
  }

  // JWT signing
  private signTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN'),
    });

    return { accessToken, refreshToken };
  }

  // Email + Password
  async register(dto: RegisterDto) {
    const existing = await this.drizzle.db
      .select()
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException('Email already in use');
    }

    // 转为哈希存储密码
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const [user] = await this.drizzle.db
      .insert(users)
      .values({ email: dto.email, name: dto.name, passwordHash })
      .returning();

    const [org] = await this.drizzle.db
      .insert(organizations)
      .values({
        name: `${dto.name}'s Org`,
        slug: this.generateOrgSlug(dto.name),
      })
      .returning();

    await this.drizzle.db.insert(orgMembers).values({
      orgId: org.id,
      userId: user.id,
      role: 'admin',
    });

    return this.signTokens(user.id, user.email);
  }

  async login(dto: LoginDto) {
    const [user] = await this.drizzle.db
      .select()
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.signTokens(user.id, user.email);
  }

  // 重新签发 JWT
  async refreshTokens(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const [user] = await this.drizzle.db
        .select()
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);

      if (!user) throw new UnauthorizedException();

      return this.signTokens(user.id, user.email);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  // OAuth upsert helpers
  async handleOAuthUser(profile: {
    email: string;
    name: string;
    avatarUrl: string | null;
  }) {
    let [user] = await this.drizzle.db
      .select()
      .from(users)
      .where(eq(users.email, profile.email))
      .limit(1);

    // 用户不存在则创建新用户
    if (!user) {
      const [newUser] = await this.drizzle.db
        .insert(users)
        .values({
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
        })
        .returning();

      user = newUser;

      const [org] = await this.drizzle.db
        .insert(organizations)
        .values({
          name: `${profile.name}'s Org`,
          slug: this.generateOrgSlug(profile.name),
        })
        .returning();

      await this.drizzle.db.insert(orgMembers).values({
        orgId: org.id,
        userId: user.id,
        role: 'admin',
      });
    }

    return this.signTokens(user.id, user.email);
  }

  // 获取谷歌认证地址
  getGoogleAuthUrl() {
    const params = new URLSearchParams({
      client_id: this.configService.get<string>('GOOGLE_CLIENT_ID')!,
      redirect_uri: this.configService.get<string>('GOOGLE_CALLBACK_URL')!,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleGoogleCallback(code: string) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.configService.get<string>('GOOGLE_CLIENT_ID')!,
        client_secret: this.configService.get<string>('GOOGLE_CLIENT_SECRET')!,
        redirect_uri: this.configService.get<string>('GOOGLE_CALLBACK_URL')!,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      },
    );

    const profile = (await profileRes.json()) as {
      email: string;
      name: string;
      picture: string | null;
    };

    return this.handleOAuthUser({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture ?? null,
    });
  }

  // Github
  getGithubAuthUrl() {
    const params = new URLSearchParams({
      client_id: this.configService.get<string>('GITHUB_CLIENT_ID')!,
      redirect_uri: this.configService.get<string>('GITHUB_CALLBACK_URL')!,
      scope: 'read:user user:email',
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async handleGithubCallback(code: string) {
    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: this.configService.get<string>('GITHUB_CLIENT_ID'),
          client_secret: this.configService.get<string>('GITHUB_CLIENT_SECRET'),
          code,
          redirect_uri: this.configService.get<string>('GITHUB_CALLBACK_URL'),
        }),
      },
    );

    const tokenData = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    const profile = (await profileRes.json()) as {
      email: string | null;
      name: string | null;
      login: string;
      avatar_url: string | null;
    };

    let email = profile.email;
    if (!email) {
      const emailRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      const emails = (await emailRes.json()) as {
        email: string;
        primary: boolean;
        verified: boolean;
      }[];
      email = emails.find((e) => e.primary && e.verified)?.email ?? null;
    }

    return this.handleOAuthUser({
      email: email!,
      name: profile.name ?? profile.login,
      avatarUrl: profile.avatar_url ?? null,
    });
  }
}
