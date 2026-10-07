import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RealtimeService } from '../realtime.service.js';
import { REALTIME_EVENTS, PROJECT_KEY_ROLES } from '@novabase/constants';
import type { RealtimeEvent } from '@novabase/types';
import type { ProjectKeyPayload } from '../../project-api/guards/project-key.guard.js';
import type { RealtimeSocket } from '../types/realtime-socket.types.js';

type SocketCallbackEntry = {
  projectId: string;
  tableName: string;
  callback: (event: RealtimeEvent) => void;
};

// 接收前端的 Socket 连接
// 网关只负责监听和转发
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: process.env.WEB_URL ?? 'http://localhost:3001',
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  // 很奇怪；注入 socket.io 的 Server 实例
  @WebSocketServer()
  server: Server;

  // 记录连接的所有订阅记录
  // key 为 client.id
  private socketCallbacks = new Map<string, SocketCallbackEntry[]>();

  constructor(
    private realtimeService: RealtimeService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // 连接即鉴权
  // handleConnection 触发早于 Guard 触发
  async handleConnection(client: RealtimeSocket) {
    const token = client.handshake.auth['token'] as string | undefined;

    if (!token) {
      client.emit(REALTIME_EVENTS.ERROR, 'Missing API key');
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify<ProjectKeyPayload>(token, {
        secret: this.configService.get<string>('PROJECT_JWT_SECRET'),
      });

      if (
        payload.role !== PROJECT_KEY_ROLES.ANON &&
        payload.role !== PROJECT_KEY_ROLES.SERVICE_ROLE
      ) {
        throw new Error('Invalid key role');
      }

      // 在 client 中挂载自定义数据
      client.data.projectId = payload.projectId;
      client.data.role = payload.role;
      await client.join(`project:${payload.projectId}`);
    } catch {
      client.emit(REALTIME_EVENTS.ERROR, 'Invalid API key');
      client.disconnect();
    }
  }

  // 断开连接时资源回收
  handleDisconnect(client: Socket) {
    const callbacks = this.socketCallbacks.get(client.id) ?? [];
    for (const { projectId, tableName, callback } of callbacks) {
      this.realtimeService.unsubscribe(projectId, tableName, callback);
    }
    this.socketCallbacks.delete(client.id);
  }

  // 声明监听 subscribe 事件，客户端发来事件时触发
  @SubscribeMessage(REALTIME_EVENTS.SUBSCRIBE)
  async handleSubscribe(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() tableName: string,
  ) {
    const projectId = client.data.projectId;
    if (!projectId || !tableName?.trim()) return;

    // BUG：SQL 注入？？？
    const normalizedTable = tableName.trim();
    const room = `project:${projectId}:table:${normalizedTable}`;

    // client.id 是 Socket 给客户端分配的唯一 id
    const existing = this.socketCallbacks.get(client.id) ?? [];

    // 如果已经订阅过了就直接返回
    if (
      existing.some(
        (entry) =>
          entry.projectId === projectId && entry.tableName === normalizedTable,
      )
    ) {
      return;
    }

    // 加入一个房间
    await client.join(room);

    // 定义回调；数据库有事件就 emit 给这个房间所有连接
    const callback = (event: RealtimeEvent) => {
      this.server.to(room).emit(REALTIME_EVENTS.EVENT, event);
    };

    // 将逻辑下沉到 realtimeService 中，数据库有变化触发 callback
    await this.realtimeService.subscribe(projectId, normalizedTable, callback);

    // 记录
    existing.push({
      projectId,
      tableName: normalizedTable,
      callback,
    });
    this.socketCallbacks.set(client.id, existing);
  }

  // 取消订阅处理函数
  @SubscribeMessage(REALTIME_EVENTS.UNSUBSCRIBE)
  async handleUnsubscribe(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() tableName: string,
  ) {
    const projectId = client.data.projectId;
    if (!projectId || !tableName?.trim()) return;

    const normalizedTable = tableName.trim();
    const room = `project:${projectId}:table:${normalizedTable}`;

    // 离开该房间
    await client.leave(room);

    // 处理资源释放
    const callbacks = this.socketCallbacks.get(client.id) ?? [];
    const entry = callbacks.find(
      (c) => c.projectId === projectId && c.tableName === normalizedTable,
    );

    if (entry) {
      this.realtimeService.unsubscribe(
        projectId,
        normalizedTable,
        entry.callback,
      );
      this.socketCallbacks.set(
        client.id,
        callbacks.filter((c) => c !== entry),
      );
    }
  }
}
