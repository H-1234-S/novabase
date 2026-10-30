import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@novabase/constants';
import { env } from '@/lib/env';

/** 服务端对订阅/退订请求的应答 */
export type SubscriptionAck =
  | {
      ok: true;
      cursor?: string;
      gap?: 'none' | 'replayed' | 'expired';
      replayed?: number;
    }
  | { ok: false; code: string; message: string };

/** 订阅请求的超时时间（毫秒） */
const ACK_TIMEOUT_MS = 5000;

/**
 * WebSocket 命名空间挂在 API 根路径下而不是 `/api` 下，
 * 因此需要把 `/api` 后缀去掉。
 */
export function getRealtimeSocketBaseUrl(): string {
  return env.apiUrl.replace(/\/api\/?$/, '');
}

/** 建立到实时网关的连接 */
export function createRealtimeSocket(anonKey: string): Socket {
  return io(`${getRealtimeSocketBaseUrl()}/realtime`, {
    auth: { token: anonKey },
    // 优先 websocket，失败回退 polling
    transports: ['websocket', 'polling'],
  });
}

/** 发送订阅/退订请求并等待服务端 ack，超时或应答非法时返回失败 */
export function emitSubscription(
  socket: Socket,
  event: string,
  tableName: string,
  since?: string,
): Promise<SubscriptionAck> {
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () =>
        resolve({
          ok: false,
          code: 'ACK_TIMEOUT',
          message: 'Realtime server did not respond',
        }),
      ACK_TIMEOUT_MS,
    );

    const payload =
      event === REALTIME_EVENTS.SUBSCRIBE
        ? { table: tableName, since }
        : tableName;

    socket.emit(event, payload, (response: SubscriptionAck) => {
      clearTimeout(timeout);
      resolve(
        response ?? {
          ok: false,
          code: 'INVALID_ACK',
          message: 'Invalid server response',
        },
      );
    });
  });
}
