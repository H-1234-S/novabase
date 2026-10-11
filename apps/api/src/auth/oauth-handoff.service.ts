import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

type HandoffEntry = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

/**
 * OAuth 回跳的一次性凭证。
 *
 * 跨域部署时 API 域下写的 Cookie 浏览器不会带给 web 域，所以回调不再直接
 * Set-Cookie，而是先生成一个短生命周期的 handoff code 跳回 web，
 * 由 web 的 /auth/callback 用 code 换 token 后在自己域下写 Cookie。
 *
 * token 全程只在服务端流转，不会出现在浏览器地址栏或前端存储里。
 */
@Injectable()
export class OAuthHandoffService {
  private readonly handoffs = new Map<string, HandoffEntry>();

  /** code 有效期：60 秒，足够完成一次跳转 */
  private readonly ttlMs = 60_000;

  create(tokens: { accessToken: string; refreshToken: string }): string {
    this.sweep();

    const code = randomBytes(32).toString('hex');
    this.handoffs.set(code, {
      ...tokens,
      expiresAt: Date.now() + this.ttlMs,
    });
    return code;
  }

  consume(code: string): { accessToken: string; refreshToken: string } | null {
    const entry = this.handoffs.get(code);
    if (!entry) return null;

    // 一次性：无论是否过期都先删掉，避免重复使用
    this.handoffs.delete(code);

    if (Date.now() > entry.expiresAt) return null;

    return {
      accessToken: entry.accessToken,
      refreshToken: entry.refreshToken,
    };
  }

  /** 清掉过期但没人来换的 code，防止内存无限增长 */
  private sweep() {
    const now = Date.now();
    for (const [code, entry] of this.handoffs) {
      if (now > entry.expiresAt) this.handoffs.delete(code);
    }
  }
}
