import { HttpException } from '@nestjs/common';
import {
  Ack,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RealtimeService } from '../realtime.service.js';
import { REALTIME_EVENTS, PROJECT_KEY_ROLES } from '@novabase/constants';
import type { RealtimeEvent } from '@novabase/types';
import type { ProjectKeyPayload } from '../../project-api/guards/project-key.guard.js';
import type { RealtimeSocket } from '../types/realtime-socket.types.js';

type AckResponse =
  | {
      ok: true;
      cursor?: string;
      gap?: 'none' | 'replayed' | 'expired';
      replayed?: number;
    }
  | { ok: false; code: string; message: string };
type SocketSubscription = {
  projectId: string;
  tableName: string;
  callback: (event: RealtimeEvent) => void;
  cancelled: boolean;
  ready: boolean;
  replaying: boolean;
  recovering: boolean;
  buffer: RealtimeEvent[];
  lastSeq: bigint;
};
type ParsedSubscribe = { tableName: string; since?: string };
type AckCallback = (response: AckResponse) => void;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const CURSOR = /^[0-9]{1,20}$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const MAX_SUBSCRIPTIONS_PER_SOCKET = 10;

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: process.env.WEB_URL ?? 'http://localhost:3001',
    credentials: true,
  },
  maxHttpBufferSize: 16 * 1024,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly socketSubscriptions = new Map<
    string,
    Map<string, SocketSubscription>
  >();
  private readonly projectSockets = new Map<string, Set<string>>();
  private readonly socketProjects = new Map<string, string>();

  constructor(
    private realtimeService: RealtimeService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: RealtimeSocket): Promise<void> {
    const token = client.handshake.auth?.['token'];
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > 4096
    ) {
      client.emit(REALTIME_EVENTS.ERROR, 'Missing or invalid API key');
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<ProjectKeyPayload>(token, {
        secret: this.configService.get<string>('PROJECT_JWT_SECRET'),
      });
      if (
        !UUID.test(payload.projectId) ||
        (payload.role !== PROJECT_KEY_ROLES.ANON &&
          payload.role !== PROJECT_KEY_ROLES.SERVICE_ROLE)
      ) {
        throw new Error('Invalid project key claims');
      }
      const sockets =
        this.projectSockets.get(payload.projectId) ?? new Set<string>();
      const maxProjectSockets = this.readLimit(
        'REALTIME_MAX_SOCKETS_PER_PROJECT',
        500,
      );
      const maxTotalSockets = this.readLimit('REALTIME_MAX_SOCKETS', 2000);
      let totalSockets = 0;
      for (const projectSockets of this.projectSockets.values())
        totalSockets += projectSockets.size;
      if (
        sockets.size >= maxProjectSockets ||
        totalSockets >= maxTotalSockets
      ) {
        client.emit(
          REALTIME_EVENTS.ERROR,
          'Realtime connection capacity reached',
        );
        client.disconnect(true);
        return;
      }
      sockets.add(client.id);
      this.projectSockets.set(payload.projectId, sockets);
      this.socketProjects.set(client.id, payload.projectId);
      client.data.projectId = payload.projectId;
      client.data.role = payload.role;
      await client.join(`project:${payload.projectId}`);
    } catch {
      this.removeProjectSocket(client.id);
      client.emit(REALTIME_EVENTS.ERROR, 'Invalid API key');
      client.disconnect(true);
    }
  }

  private readLimit(key: string, fallback: number): number {
    const value = Number(this.configService.get<string>(key));
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  private removeProjectSocket(socketId: string): void {
    const projectId = this.socketProjects.get(socketId);
    if (!projectId) return;
    this.socketProjects.delete(socketId);
    const sockets = this.projectSockets.get(projectId);
    sockets?.delete(socketId);
    if (sockets?.size === 0) this.projectSockets.delete(projectId);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.removeProjectSocket(client.id);
    const subscriptions = this.socketSubscriptions.get(client.id);
    this.socketSubscriptions.delete(client.id);
    if (!subscriptions) return;

    await Promise.allSettled(
      [...subscriptions.values()].map(async (subscription) => {
        subscription.cancelled = true;
        subscription.buffer.length = 0;
        await this.realtimeService.unsubscribe(
          subscription.projectId,
          subscription.tableName,
          subscription.callback,
        );
      }),
    );
  }

  private acknowledge(
    ack: AckCallback | undefined,
    response: AckResponse,
  ): void {
    try {
      ack?.(response);
    } catch (error) {
      console.error('[realtime] socket acknowledgement failed', error);
    }
  }

  private parseTableName(value: unknown): string | undefined {
    if (typeof value !== 'string' || !TABLE.test(value)) return undefined;
    return value;
  }

  private parseSubscribePayload(value: unknown):
    | { parsed: ParsedSubscribe }
    | { error: 'INVALID_TABLE' | 'INVALID_CURSOR' } {
    const tableName =
      typeof value === 'string'
        ? this.parseTableName(value)
        : value && typeof value === 'object' && !Array.isArray(value)
          ? this.parseTableName((value as Record<string, unknown>).table)
          : undefined;
    if (!tableName) return { error: 'INVALID_TABLE' };
    if (typeof value === 'string') return { parsed: { tableName } };

    const since = (value as Record<string, unknown>).since;
    if (since === undefined) return { parsed: { tableName } };
    if (typeof since !== 'string' || !CURSOR.test(since)) {
      return { error: 'INVALID_CURSOR' };
    }
    try {
      if (BigInt(since) > MAX_BIGINT) return { error: 'INVALID_CURSOR' };
    } catch {
      return { error: 'INVALID_CURSOR' };
    }
    return { parsed: { tableName, since } };
  }

  private isCurrentSubscription(
    client: RealtimeSocket,
    subscription: SocketSubscription,
  ): boolean {
    return (
      client.connected &&
      !subscription.cancelled &&
      this.socketSubscriptions.get(client.id)?.get(subscription.tableName) ===
        subscription
    );
  }

  private deliverEvent(
    client: RealtimeSocket,
    subscription: SocketSubscription,
    event: RealtimeEvent,
  ): boolean {
    if (!this.isCurrentSubscription(client, subscription)) return false;
    if (typeof event.seq !== 'string' || !CURSOR.test(event.seq)) return false;
    const seq = BigInt(event.seq);
    if (seq <= subscription.lastSeq) return false;
    subscription.lastSeq = seq;
    client.emit(REALTIME_EVENTS.EVENT, event);
    return true;
  }

  private drainBufferedEvents(
    client: RealtimeSocket,
    subscription: SocketSubscription,
  ): void {
    while (subscription.buffer.length > 0) {
      const events = subscription.buffer.splice(0).sort((a, b) => {
        const left = BigInt(a.seq);
        const right = BigInt(b.seq);
        return left < right ? -1 : left > right ? 1 : 0;
      });
      for (const event of events) this.deliverEvent(client, subscription, event);
    }
    subscription.replaying = false;
  }

  private async recoverSubscription(
    client: RealtimeSocket,
    subscription: SocketSubscription,
  ): Promise<void> {
    if (
      !subscription.ready ||
      subscription.recovering ||
      !this.isCurrentSubscription(client, subscription)
    )
      return;
    subscription.recovering = true;
    subscription.replaying = true;
    try {
      const replay = await this.realtimeService.replay(
        subscription.projectId,
        subscription.tableName,
        subscription.lastSeq.toString(),
      );
      if (!this.isCurrentSubscription(client, subscription)) return;
      if (replay.gap === 'expired') {
        subscription.lastSeq = BigInt(replay.cursor);
        client.emit(REALTIME_EVENTS.ERROR, {
          code: 'CURSOR_EXPIRED',
          table: subscription.tableName,
          cursor: replay.cursor,
          message: 'Replay window expired; resynchronize from a data snapshot',
        });
      } else {
        for (const event of replay.events) {
          this.deliverEvent(client, subscription, event);
        }
      }
      this.drainBufferedEvents(client, subscription);
    } catch (error) {
      console.error('[realtime] cursor replay failed', error);
      client.emit(REALTIME_EVENTS.ERROR, {
        code: 'CURSOR_REPLAY_FAILED',
        table: subscription.tableName,
        message: 'Could not replay missed events',
      });
      this.drainBufferedEvents(client, subscription);
    } finally {
      subscription.recovering = false;
    }
  }

  @SubscribeMessage(REALTIME_EVENTS.SUBSCRIBE)
  async handleSubscribe(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() payload: unknown,
    @Ack() ack?: AckCallback,
  ): Promise<void> {
    const projectId = client.data.projectId;
    const parsedPayload = this.parseSubscribePayload(payload);
    if (!projectId || 'error' in parsedPayload) {
      this.acknowledge(ack, {
        ok: false,
        code: 'error' in parsedPayload ? parsedPayload.error : 'INVALID_TABLE',
        message:
          'error' in parsedPayload && parsedPayload.error === 'INVALID_CURSOR'
            ? 'Invalid realtime cursor'
            : 'Invalid table name',
      });
      return;
    }
    const { tableName, since: requestedSince } = parsedPayload.parsed;

    let subscriptions = this.socketSubscriptions.get(client.id);
    if (!subscriptions) {
      subscriptions = new Map();
      this.socketSubscriptions.set(client.id, subscriptions);
    }

    const current = subscriptions.get(tableName);
    if (current) {
      if (current.ready)
        this.acknowledge(ack, {
          ok: true,
          cursor: current.lastSeq.toString(),
          gap: 'none',
          replayed: 0,
        });
      else
        this.acknowledge(ack, {
          ok: false,
          code: 'SUBSCRIBE_IN_PROGRESS',
          message: 'Subscription is already being initialized',
        });
      return;
    }
    if (subscriptions.size >= MAX_SUBSCRIPTIONS_PER_SOCKET) {
      this.acknowledge(ack, {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: 'Too many table subscriptions on this connection',
      });
      return;
    }

    const room = `project:${projectId}:table:${tableName}`;
    const subscription: SocketSubscription = {
      projectId,
      tableName,
      callback: (event) => {
        if (subscription.cancelled) return;
        if (subscription.replaying) subscription.buffer.push(event);
        else this.deliverEvent(client, subscription, event);
      },
      cancelled: false,
      ready: false,
      replaying: true,
      recovering: false,
      buffer: [],
      lastSeq: BigInt(requestedSince ?? '0'),
    };
    // Reserve before any asynchronous work so disconnect/unsubscribe can cancel it.
    subscriptions.set(tableName, subscription);

    try {
      // A fresh subscription starts at a pre-LISTEN baseline. Any commit after
      // this read is captured either by LISTEN or the outbox replay below.
      const since =
        requestedSince ??
        (await this.realtimeService.currentCursor(projectId, tableName));
      if (!this.isCurrentSubscription(client, subscription)) {
        this.acknowledge(ack, {
          ok: false,
          code: 'SUBSCRIPTION_CANCELLED',
          message: 'Subscription was cancelled',
        });
        return;
      }
      subscription.lastSeq = BigInt(since);
      await this.realtimeService.subscribe(
        projectId,
        tableName,
        subscription.callback,
        (() => {
          let reconnecting = false;
          return (status) => {
            if (status === 'reconnecting') {
              reconnecting = true;
              subscription.replaying = true;
              client.emit(REALTIME_EVENTS.ERROR, {
                code: 'LISTENER_RECONNECTING',
                table: tableName,
                message: 'Database listener reconnecting; events may be missed',
              });
            } else if (reconnecting) {
              reconnecting = false;
              client.emit(REALTIME_EVENTS.ERROR, {
                code: 'LISTENER_CONNECTED',
                table: tableName,
                message: 'Database listener restored',
              });
              void this.recoverSubscription(client, subscription);
            }
          };
        })(),
      );

      if (!this.isCurrentSubscription(client, subscription)) {
        await this.realtimeService.unsubscribe(
          projectId,
          tableName,
          subscription.callback,
        );
        await client.leave(room);
        this.acknowledge(ack, {
          ok: false,
          code: 'SUBSCRIPTION_CANCELLED',
          message: 'Subscription was cancelled',
        });
        return;
      }

      let gap: 'none' | 'replayed' | 'expired' = 'none';
      let replayed = 0;
      const first = await this.realtimeService.replay(
        projectId,
        tableName,
        since,
      );
      if (!this.isCurrentSubscription(client, subscription)) {
        await this.realtimeService.unsubscribe(
          projectId,
          tableName,
          subscription.callback,
        );
        return;
      }
      if (first.gap === 'expired') {
        gap = 'expired';
        subscription.lastSeq = BigInt(first.cursor);
      } else {
        for (const event of first.events) {
          if (this.deliverEvent(client, subscription, event)) replayed += 1;
        }
        if (first.gap === 'replayed') gap = 'replayed';
      }

      await client.join(room);
      if (!this.isCurrentSubscription(client, subscription)) {
        await this.realtimeService.unsubscribe(
          projectId,
          tableName,
          subscription.callback,
        );
        await client.leave(room);
        this.acknowledge(ack, {
          ok: false,
          code: 'SUBSCRIPTION_CANCELLED',
          message: 'Subscription was cancelled',
        });
        return;
      }

      // This second pass closes the interval between the first replay and room
      // join. Events also arriving live may be duplicated once; seq de-dup drops it.
      const second = await this.realtimeService.replay(
        projectId,
        tableName,
        subscription.lastSeq.toString(),
      );
      if (second.gap === 'expired') {
        gap = 'expired';
        subscription.lastSeq = BigInt(second.cursor);
      } else {
        for (const event of second.events) {
          if (this.deliverEvent(client, subscription, event)) replayed += 1;
        }
        if (second.gap === 'replayed' && gap === 'none') gap = 'replayed';
      }
      if (!this.isCurrentSubscription(client, subscription)) {
        await this.realtimeService.unsubscribe(
          projectId,
          tableName,
          subscription.callback,
        );
        await client.leave(room);
        this.acknowledge(ack, {
          ok: false,
          code: 'SUBSCRIPTION_CANCELLED',
          message: 'Subscription was cancelled',
        });
        return;
      }
      this.drainBufferedEvents(client, subscription);

      subscription.ready = true;
      this.acknowledge(ack, {
        ok: true,
        cursor: subscription.lastSeq.toString(),
        gap,
        replayed,
      });
    } catch (error) {
      if (
        this.socketSubscriptions.get(client.id)?.get(tableName) === subscription
      ) {
        this.socketSubscriptions.get(client.id)?.delete(tableName);
      }
      subscription.cancelled = true;
      subscription.replaying = false;
      subscription.buffer.length = 0;
      await this.realtimeService
        .unsubscribe(projectId, tableName, subscription.callback)
        .catch((cleanupError: unknown) => {
          console.error(
            '[realtime] failed to clean up subscription',
            cleanupError,
          );
        });
      try {
        await client.leave(room);
      } catch {
        // Socket may already be disconnected; cleanup of DB callback is done below.
      }
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const code =
        status === 400
          ? 'INVALID_CURSOR'
          : status === 404
          ? 'REALTIME_NOT_ENABLED'
          : status === 429
            ? 'LIMIT_EXCEEDED'
            : 'SUBSCRIBE_FAILED';
      this.acknowledge(ack, {
        ok: false,
        code,
        message:
          status === 400
            ? 'Invalid realtime cursor'
            : status === 404
            ? 'Realtime is not enabled for this table'
            : status === 429
              ? 'Realtime capacity reached'
              : 'Could not subscribe to this table',
      });
    }
  }

  @SubscribeMessage(REALTIME_EVENTS.UNSUBSCRIBE)
  async handleUnsubscribe(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() payload: unknown,
    @Ack() ack?: AckCallback,
  ): Promise<void> {
    const projectId = client.data.projectId;
    const tableName =
      typeof payload === 'string'
        ? this.parseTableName(payload)
        : payload && typeof payload === 'object' && !Array.isArray(payload)
          ? this.parseTableName((payload as Record<string, unknown>).table)
          : undefined;
    if (!projectId || !tableName) {
      this.acknowledge(ack, {
        ok: false,
        code: 'INVALID_TABLE',
        message: 'Invalid table name',
      });
      return;
    }

    const subscriptions = this.socketSubscriptions.get(client.id);
    const subscription = subscriptions?.get(tableName);
    const room = `project:${projectId}:table:${tableName}`;
    if (subscription) {
      subscription.cancelled = true;
      subscription.buffer.length = 0;
      subscriptions?.delete(tableName);
      try {
        await this.realtimeService.unsubscribe(
          projectId,
          tableName,
          subscription.callback,
        );
      } catch (error) {
        console.error('[realtime] unsubscribe cleanup failed', error);
      }
    }
    await client.leave(room);
    this.acknowledge(ack, { ok: true });
  }
}
