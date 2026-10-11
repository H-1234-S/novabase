import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_KEYS } from '@novabase/constants';

/**
 * 同源 API 代理。
 *
 * 生产环境里浏览器只访问 web 域名，前端所有请求打到 `/api/proxy/*`，
 * 由这里转发到真正的 NestJS 服务（API_URL）。好处：
 * - 不再需要 CORS，浏览器侧只有一个域名
 * - Cookie 是同源写入，`SameSite=Lax` 也能正常带上
 */
function getApiBase(): string {
  const url = process.env.API_URL;
  if (!url) {
    throw new Error('API_URL is not configured');
  }
  return url.replace(/\/$/, '');
}

function buildCookieHeader(req: NextRequest): string | undefined {
  const access = req.cookies.get(COOKIE_KEYS.ACCESS_TOKEN)?.value;
  const refresh = req.cookies.get(COOKIE_KEYS.REFRESH_TOKEN)?.value;
  const parts: string[] = [];
  if (access) parts.push(`${COOKIE_KEYS.ACCESS_TOKEN}=${access}`);
  if (refresh) parts.push(`${COOKIE_KEYS.REFRESH_TOKEN}=${refresh}`);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

async function proxyRequest(
  req: NextRequest,
  pathSegments: string[],
): Promise<NextResponse> {
  const path = pathSegments.join('/');
  const target = `${getApiBase()}/${path}${req.nextUrl.search}`;

  const headers = new Headers();
  const contentType = req.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);

  const cookieHeader = buildCookieHeader(req);
  if (cookieHeader) headers.set('Cookie', cookieHeader);

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await req.text() : undefined;

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: body || undefined,
    redirect: 'manual',
  });

  // OAuth 之类需要跳转的响应，原样透传 Location
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get('Location');
    if (location) {
      return NextResponse.redirect(location, upstream.status);
    }
  }

  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get('Content-Type');
  if (upstreamType) responseHeaders.set('Content-Type', upstreamType);

  // 把上游的 Set-Cookie 原样写回浏览器
  for (const setCookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('Set-Cookie', setCookie);
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
