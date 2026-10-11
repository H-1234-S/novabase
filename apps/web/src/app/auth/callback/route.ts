import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_KEYS } from '@novabase/constants';

/**
 * OAuth 登录回跳终点。
 *
 * 流程：Google/GitHub -> API 回调 -> 302 到这里并带上一次性 code
 * -> 服务端拿 code 找 API 换 token -> 在 web 域写 httpOnly Cookie -> /dashboard
 *
 * token 不会经过浏览器 JS，也不会出现在地址栏里。
 */
export const dynamic = 'force-dynamic';

function setAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
) {
  const secure = process.env.NODE_ENV === 'production';

  response.cookies.set(COOKIE_KEYS.ACCESS_TOKEN, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,
  });

  response.cookies.set(COOKIE_KEYS.REFRESH_TOKEN, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const apiUrl = process.env.API_URL?.replace(/\/$/, '');
  if (!apiUrl) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const handoffRes = await fetch(`${apiUrl}/auth/handoff/${code}`, {
    cache: 'no-store',
  });

  if (!handoffRes.ok) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const tokens = (await handoffRes.json()) as {
    accessToken: string;
    refreshToken: string;
  };

  const response = NextResponse.redirect(new URL('/dashboard', request.url));
  setAuthCookies(response, tokens);
  return response;
}
