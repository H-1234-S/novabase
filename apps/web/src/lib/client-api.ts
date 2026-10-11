/**
 * 浏览器侧访问后端的基址。
 *
 * 生产环境不再直连 API 域名：NEXT_PUBLIC_API_URL 留空时会回落到同源的
 * `/api/proxy`，由 Next 的 Route Handler 转发到真正的 NestJS 服务。
 * 这样浏览器只需要暴露 web 一个域名，Cookie 天然同源，也不会有 CORS 问题。
 */
export function getClientApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured?.startsWith('http')) {
    return configured.replace(/\/$/, '');
  }
  return '/api/proxy';
}

/** 同源请求的 origin（兼容 `/api/proxy` 这种相对基址）。 */
export function getClientApiOrigin(): string {
  const base = getClientApiBase();
  if (base.startsWith('http')) {
    return new URL(base).origin;
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
}

/**
 * WebSocket 的 origin。
 *
 * Realtime 走 Socket.IO，namespace 不在 /api 下，而且 WebSocket 无法被
 * Next 的 Route Handler 代理，所以这里始终指向 NestJS 本身。
 */
export function getRealtimeOrigin(apiUrl?: string): string {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (configured) return configured.replace(/\/$/, '');

  const source =
    apiUrl ??
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3000/api';

  return source.replace(/\/api\/?$/, '').replace(/\/$/, '');
}
