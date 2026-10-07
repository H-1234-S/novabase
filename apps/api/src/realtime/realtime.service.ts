import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, neonConfig } from '@neondatabase/serverless';
import { TriggerService } from './trigger.service.js';
import type { RealtimeEvent } from '@novabase/types';

// 使用 Node 内置的全局 WebSocket
neonConfig.webSocketConstructor = WebSocket;

type NotifyCallback = (event: RealtimeEvent) => void;

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  // key 是频道名
  private listeners = new Map<
    string,
    {
      client: Client;
      callbacks: Set<NotifyCallback>;
    }
  >();

  constructor(private configService: ConfigService) {}

  // Neon 的 LISTEN/NOTIFY 需要直连（非连接池）连接
  private getListenConnectionString(): string {
    const realtime = this.configService.get<string>('REALTIME_DATABASE_URL');
    const database = this.configService.get<string>('DATABASE_URL');
    const url = realtime ?? database;
    if (!url) {
      throw new Error('DATABASE_URL is not configured');
    }

    // LISTEN/NOTIFY 必须走直连，不能走连接池(pooler)
    let clean = url.replace('-pooler', '').trim();
    clean = clean.replace(/([?&])(sslmode|channel_binding)=[^&]*/g, '$1');
    clean = clean.replace(/[?&]$/, '').replace(/\?&/, '?');

    // 把标准的 pooler 连接串"改造"成 Neon WebSocket 直连能接受的格式
    return clean;
  }

  // 网关每次收到浏览器的订阅请求，最终调到这里
  async subscribe(
    projectId: string,
    tableName: string,
    callback: NotifyCallback,
  ): Promise<void> {
    const channel = TriggerService.channelName(projectId, tableName);

    // channel 非第一次被订阅
    const existing = this.listeners.get(channel);
    if (existing) {
      // 更新回调
      existing.callbacks.add(callback);
      return;
    }

    const client = new Client({
      connectionString: this.getListenConnectionString(),
    });

    // LISTEN 通过长连接的 Neon WebSocket 运行。当连接断开时，客户端
    // 会触发 'error' 事件；如果没有监听器，Node 会将其视为未处理异常并终止进程。

    // 记录该日志并关闭此通道，以便后续的订阅操作可以重新建立连接。
    client.on('error', (err) => {
      console.error(
        `[realtime] LISTEN connection error on channel "${channel}":`,
        err.message,
      );
      if (this.listeners.get(channel)?.client === client) {
        this.listeners.delete(channel);
      }
    });

    // 建立连接
    await client.connect();

    // 数据库 pg_notify 广播时，Neon 客户端触发 'notification' 事件
    client.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        const event = JSON.parse(msg.payload) as RealtimeEvent;
        const entry = this.listeners.get(channel);
        entry?.callbacks.forEach((cb) => cb(event));
      } catch {
        // 格式错误的负载 — 忽略
      }
    });

    // 加入频道
    // 频道名称是小写标识符——不需要双引号
    await client.query(`LISTEN ${channel}`);

    this.listeners.set(channel, {
      client,
      callbacks: new Set([callback]),
    });
  }

  // 处理删除监听
  unsubscribe(
    projectId: string,
    tableName: string,
    callback: NotifyCallback,
  ): void {
    const channel = TriggerService.channelName(projectId, tableName);
    const entry = this.listeners.get(channel);
    if (!entry) return;

    entry.callbacks.delete(callback);

    // 如果频道没有监听
    if (entry.callbacks.size === 0) {
      void entry.client.query(`UNLISTEN ${channel}`).finally(() => {
        // 关闭数据库连接
        void entry.client.end();
      });
      this.listeners.delete(channel);
    }
  }

  // app close 时清除所有内容，释放资源
  async onModuleDestroy() {
    await Promise.all(
      [...this.listeners.values()].map(({ client }) => client.end()),
    );
    this.listeners.clear();
  }
}
