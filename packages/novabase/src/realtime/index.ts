import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@novabase/constants';
import type { RealtimeEvent } from '@novabase/types';

export type RealtimeCallback = (event: RealtimeEvent) => void;

function getRealtimeSocketUrl(projectUrl: string): string {
  const origin = new URL(projectUrl).origin;
  // NestJS 网关命名空间在 API 主机上是 /realtime，而不是在 /api 下
  return `${origin}/realtime`;
}

export class NovabaseRealtime {
  private socket: Socket | null = null;
  // 表名 - 回调 的映射
  private callbacks = new Map<string, Set<RealtimeCallback>>();

  constructor(
    private projectUrl: string,
    private apiKey: string,
  ) {}

  // 用于建立连接
  private connect(): Socket {
    if (this.socket?.connected) return this.socket;

    this.socket = io(getRealtimeSocketUrl(this.projectUrl), {
      auth: { token: this.apiKey },
      transports: ['websocket', 'polling'],
    });

    // 掉线重连策略？
    this.socket.on('connect', () => {
      for (const table of this.callbacks.keys()) {
        this.socket?.emit(REALTIME_EVENTS.SUBSCRIBE, table);
      }
    });

    // 服务端推送触发回调
    this.socket.on(REALTIME_EVENTS.EVENT, (event: RealtimeEvent) => {
      const handlers = this.callbacks.get(event.table);
      handlers?.forEach((cb) => cb(event));
    });

    this.socket.on(REALTIME_EVENTS.ERROR, (msg: string) => {
      console.error('[novabase-js] realtime error:', msg);
    });

    return this.socket;
  }

  // 用于订阅
  subscribe(table: string, callback: RealtimeCallback): () => void {
    const socket = this.connect();

    if (!this.callbacks.has(table)) {
      this.callbacks.set(table, new Set());
      socket.emit(REALTIME_EVENTS.SUBSCRIBE, table);
    }

    this.callbacks.get(table)!.add(callback);

    // 返回一个取消订阅的函数
    return () => this.unsubscribe(table, callback);
  }

  unsubscribe(table: string, callback?: RealtimeCallback): void {
    // 回调不存在则删除所有
    if (!callback) {
      this.callbacks.delete(table);
      this.socket?.emit(REALTIME_EVENTS.UNSUBSCRIBE, table);
      return;
    }

    // 回调存在则只移除该回调
    const handlers = this.callbacks.get(table);
    if (!handlers) return;

    handlers.delete(callback);

    // 无回调时则移除监听
    if (handlers.size === 0) {
      this.callbacks.delete(table);
      this.socket?.emit(REALTIME_EVENTS.UNSUBSCRIBE, table);
    }
  }

  // 清理资源
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.callbacks.clear();
  }
}
