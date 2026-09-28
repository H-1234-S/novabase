import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '../db/drizzle.service.js';
import { organizations, orgMembers, users } from '../db/schema/index.js';
import { INVITE_EXPIRES_IN } from '@novabase/constants';

interface InvitePayload {
  email: string;
  orgId: string;
  orgName: string;
}

@Injectable()
export class InviteService {
  private resend: Resend;

  constructor(
    private drizzle: DrizzleService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.resend = new Resend(this.configService.get('RESEND_API_KEY'));
  }

  // 发送邀请
  async sendInvite(orgSlug: string, email: string) {
    // 获取该组织
    const [org] = await this.drizzle.db
      // select 是白名单，返回什么信息
      .select()
      // from 是从哪个表中查数据
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);

    if (!org) throw new BadRequestException('Organization not found');

    // 根据邀请的 email 查询现有用户
    const existingUser = await this.drizzle.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // 判断被邀请者是否是该组织成员
    if (existingUser.length > 0) {
      const existingMember = await this.drizzle.db
        .select()
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.orgId, org.id),
            eq(orgMembers.userId, existingUser[0].id),
            isNull(orgMembers.removedAt),
          ),
        )
        .limit(1);

      if (existingMember.length > 0) {
        throw new BadRequestException(
          'User is already a member of this organization',
        );
      }
    }

    // 邀请令牌 — 24小时后失效
    const token = this.jwtService.sign(
      { email, orgId: org.id, orgName: org.name } satisfies InvitePayload,
      {
        secret: this.configService.get('INVITE_SECRET'),
        expiresIn: INVITE_EXPIRES_IN,
      },
    );

    const inviteUrl = `${this.configService.get<string>('API_URL')}/auth/invite/accept?token=${token}`;

    // 通过 Resend 发送邮件
    // TODO: Switch QQ Email
    await this.resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email,
      subject: `You've been invited to join ${org.name} on NovaBase`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>You're invited to join ${org.name}</h2>
          <p>Someone has invited you to collaborate on Novabase.</p>
          <a
            href="${inviteUrl}"
            style="display: inline-block; background: #000; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
            Accept invite
          </a>
          <p style="color: #999; font-size: 13px;">This link expires in 24 hours.</p>
        </div>
      `,
    });

    return { message: 'Invite sent' };
  }

  // 处理接受邀请
  async acceptInvite(token: string) {
    let payload: InvitePayload;

    try {
      payload = this.jwtService.verify<InvitePayload>(token, {
        secret: this.configService.get('INVITE_SECRET'),
      });
    } catch {
      throw new BadRequestException('Invalid or expired invite link');
    }

    let [user] = await this.drizzle.db
      .select()
      .from(users)
      .where(eq(users.email, payload.email))
      .limit(1);

    if (!user) {
      const [newUser] = await this.drizzle.db
        .insert(users)
        .values({ email: payload.email })
        .returning();
      user = newUser;
    }

    const existing = await this.drizzle.db
      .select()
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, payload.orgId),
          eq(orgMembers.userId, user.id),
          isNull(orgMembers.removedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return { message: 'Already a member' };
    }

    await this.drizzle.db.insert(orgMembers).values({
      orgId: payload.orgId,
      userId: user.id,
      role: 'developer',
    });

    return { message: 'Invite accepted', email: user.email };
  }
}
