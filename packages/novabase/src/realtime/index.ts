import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@novabase/constants';
import type { RealtimeEvent } from '../types';

export type RealtimeCallback = (event: RealtimeEvent) => void;
export type RealtimeSubscriptionError = {
  code: string;
  message: string;
  cursor?: string;
};
export type RealtimeSubscribeOptions = {
  since?: string;
  onError?: (error: RealtimeSubscriptionError) => void;
};
type SubscriptionAck =
  | {
      ok: true;
      cursor?: string;
      gap?: 'none' | 'replayed' | 'expired';
      replayed?: number;
    }
  | { ok: false; code: string; message: string };

function getRealtimeSocketUrl(projectUrl: string): string {
  const origin = new URL(projectUrl).origin;
  // NestJS 网关命名空间在 API 主机上是 /realtime，而不是在 /api 下
  return `${origin}/realtime`;
}

export class NovabaseRealtime {
  private socket: Socket | null = null;
  // 表名 - 回调 的映射
  private callbacks = new Map<string, Set<RealtimeCallback>>();
  private errorCallbacks = new Map<
    string,
    Map<RealtimeCallback, (error: RealtimeSubscriptionError) => void>
  >();
  private cursors = new Map<string, string>();

  constructor(
    private projectUrl: string,
    private apiKey: string,
  ) {}

  // 用于建立连接
  private connect(): Socket {
    if (this.socket) return this.socket;

    this.socket = io(getRealtimeSocketUrl(this.projectUrl), {
      auth: { token: this.apiKey },
      transports: ['websocket', 'polling'],
    });

    // 掉线重连策略？
    this.socket.on('connect', () => {
      for (const table of this.callbacks.keys()) {
        this.emitSubscription(REALTIME_EVENTS.SUBSCRIBE, table);
      }
    });

    // 服务端推送触发回调
    this.socket.on(REALTIME_EVENTS.EVENT, (event: RealtimeEvent) => {
      if (!/^[0-9]{1,20}$/.test(event.seq)) return;
      const cursor = this.cursors.get(event.table);
      if (cursor && BigInt(event.seq) <= BigInt(cursor)) return;
      this.advanceCursor(event.table, event.seq);
      const handlers = this.callbacks.get(event.table);
      handlers?.forEach((cb) => {
        try {
          cb(event);
        } catch (error) {
          console.error('[novabase-js] realtime event callback failed:', error);
        }
      });
    });

    this.socket.on(
      REALTIME_EVENTS.ERROR,
      (msg: string | { code?: string; table?: string; message?: string; cursor?: string }) => {
        if (typeof msg === 'string') {
          console.error('[novabase-js] realtime error:', msg);
          return;
        }
        if (
          (msg.code === 'CURSOR_EXPIRED' ||
            msg.code === 'CURSOR_REPLAY_FAILED') &&
          msg.table
        ) {
          if (
            msg.cursor &&
            /^[0-9]{1,20}$/.test(msg.cursor) &&
            BigInt(msg.cursor) <= 9_223_372_036_854_775_807n
          ) {
            this.advanceCursor(msg.table, msg.cursor);
          }
          this.notifySubscriptionError(msg.table, {
            code: msg.code,
            message:
              msg.message ?? 'Realtime replay failed; fetch a fresh snapshot',
            cursor: msg.cursor,
          });
        }
      },
    );

    return this.socket;
  }

  // 用于订阅
  subscribe(
    table: string,
    callback: RealtimeCallback,
    options?: RealtimeSubscribeOptions | ((error: RealtimeSubscriptionError) => void),
  ): () => void {
    const socket = this.connect();
    const onError = typeof options === 'function' ? options : options?.onError;
    const since = typeof options === 'function' ? undefined : options?.since;
    if (!this.cursors.has(table) && since && /^[0-9]{1,20}$/.test(since)) {
      this.cursors.set(table, since);
    }

    const isNewTable = !this.callbacks.has(table);
    if (!this.callbacks.has(table)) {
      this.callbacks.set(table, new Set());
    }

    this.callbacks.get(table)!.add(callback);
    if (onError) {
      const handlers = this.errorCallbacks.get(table) ?? new Map();
      handlers.set(callback, onError);
      this.errorCallbacks.set(table, handlers);
    }
    if (isNewTable && socket.connected) {
      this.emitSubscription(REALTIME_EVENTS.SUBSCRIBE, table);
    }

    // 返回一个取消订阅的函数
    return () => this.unsubscribe(table, callback);
  }

  unsubscribe(table: string, callback?: RealtimeCallback): void {
    // 回调不存在则删除所有
    if (!callback) {
      this.callbacks.delete(table);
      this.errorCallbacks.delete(table);
      this.cursors.delete(table);
      this.emitSubscription(REALTIME_EVENTS.UNSUBSCRIBE, table);
      return;
    }

    // 回调存在则只移除该回调
    const handlers = this.callbacks.get(table);
    if (!handlers) return;

    handlers.delete(callback);
    const errorHandlers = this.errorCallbacks.get(table);
    errorHandlers?.delete(callback);
    if (errorHandlers?.size === 0) this.errorCallbacks.delete(table);

    // 无回调时则移除监听
    if (handlers.size === 0) {
      this.callbacks.delete(table);
      this.errorCallbacks.delete(table);
      this.cursors.delete(table);
      this.emitSubscription(REALTIME_EVENTS.UNSUBSCRIBE, table);
    }
  }

  // 清理资源
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.callbacks.clear();
    this.errorCallbacks.clear();
    this.cursors.clear();
  }

  private advanceCursor(table: string, cursor: string): void {
    const previous = this.cursors.get(table);
    if (!previous || BigInt(cursor) > BigInt(previous)) {
      this.cursors.set(table, cursor);
    }
  }

  private notifySubscriptionError(
    table: string,
    error: RealtimeSubscriptionError,
  ): void {
    const handlers = this.errorCallbacks.get(table);
    if (!handlers?.size) {
      console.error(
        '[novabase-js] realtime subscription failed:',
        error.message,
      );
      return;
    }
    handlers.forEach((handler) => handler(error));
  }

  private emitSubscription(
    event: string,
    table: string,
  ): void {
    const payload =
      event === REALTIME_EVENTS.SUBSCRIBE
        ? { table, since: this.cursors.get(table) }
        : table;
    this.socket?.emit(event, payload, (ack: SubscriptionAck) => {
      if (!ack?.ok) {
        const error = ack ?? {
          ok: false as const,
          code: 'INVALID_ACK',
          message: 'No acknowledgement',
        };
        this.notifySubscriptionError(table, {
          code: error.code,
          message: error.message,
        });
      } else {
        if (ack.cursor && /^[0-9]{1,20}$/.test(ack.cursor)) {
          this.advanceCursor(table, ack.cursor);
        }
        if (ack.gap === 'expired') {
          this.notifySubscriptionError(table, {
            code: 'CURSOR_EXPIRED',
            message: 'Replay window expired; fetch a fresh snapshot',
            cursor: ack.cursor,
          });
        }
      }
    });
  }
}
