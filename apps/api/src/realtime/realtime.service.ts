import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, neonConfig } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { DrizzleService } from '../db/drizzle.service.js';
import { TriggerService } from './trigger.service.js';
import type { RealtimeEvent } from '@novabase/types';

// Neon LISTEN requires a WebSocket-backed direct connection.
neonConfig.webSocketConstructor = WebSocket;

type ChannelStatus = 'connecting' | 'ready' | 'retrying' | 'closing';
type StatusCallback = (status: 'reconnecting' | 'connected') => void;
type Subscription = {
  callback: (event: RealtimeEvent) => void;
  onStatus?: StatusCallback;
};
type ChannelEntry = {
  channel: string;
  projectId: string;
  tableName: string;
  client?: Client;
  status: ChannelStatus;
  subscriptions: Map<Subscription['callback'], Subscription>;
  connectPromise?: Promise<void>;
  retryTimer?: ReturnType<typeof setTimeout>;
  retryAttempt: number;
  closing: boolean;
  closePromise?: Promise<void>;
  lastEmittedSeq: bigint;
};

type ReplayGap = 'none' | 'replayed' | 'expired';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_IDENTIFIER_BYTES = 63;

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly listeners = new Map<string, ChannelEntry>();
  private readonly closingEntries = new Set<ChannelEntry>();
  private shuttingDown = false;

  constructor(
    private configService: ConfigService,
    private drizzle: DrizzleService,
  ) {}

  private getLimit(key: string, fallback: number): number {
    const configured = Number(this.configService.get<string>(key));
    return Number.isSafeInteger(configured) && configured > 0
      ? configured
      : fallback;
  }

  private getListenConnectionString(): string {
    const realtime = this.configService.get<string>('REALTIME_DATABASE_URL');
    const database = this.configService.get<string>('DATABASE_URL');
    const url = realtime ?? database;
    if (!url)
      throw new Error(
        'REALTIME_DATABASE_URL or DATABASE_URL is not configured',
      );

    // LISTEN needs a direct session; Neon pooler endpoints cannot retain it.
    let clean = url.trim().replace('-pooler', '');
    clean = clean.replace(/([?&])(sslmode|channel_binding)=[^&]*/g, '$1');
    return clean.replace(/[?&]$/, '').replace(/\?&/, '?');
  }

  private assertTableName(tableName: unknown): asserts tableName is string {
    if (
      typeof tableName !== 'string' ||
      !IDENTIFIER.test(tableName) ||
      Buffer.byteLength(tableName, 'utf8') > MAX_IDENTIFIER_BYTES
    ) {
      throw new NotFoundException('Realtime table not found');
    }
  }

  /** Only tables with the managed Realtime trigger may consume a listener. */
  private async assertRealtimeEnabled(
    projectId: string,
    tableName: string,
  ): Promise<string> {
    this.assertTableName(tableName);
    const triggerName = TriggerService.triggerName(projectId, tableName);
    const result = await this.drizzle.db.execute<{
      dbSchema: string;
      enabled: boolean;
    }>(sql`
      SELECT p.db_schema AS "dbSchema",
        EXISTS (
          SELECT 1
          FROM information_schema.triggers t
          WHERE t.trigger_schema = p.db_schema
            AND t.event_object_table = ${tableName}
            AND t.trigger_name = ${triggerName}
        ) AS enabled
      FROM projects p
      WHERE p.id = ${projectId}
      LIMIT 1
    `);

    if (!result.rows[0]) throw new NotFoundException('Project not found');
    if (!result.rows[0].enabled) {
      throw new NotFoundException('Realtime is not enabled for this table');
    }
    return result.rows[0].dbSchema;
  }

  private async readOutboxState(schema: string, tableName: string) {
    const result = await this.drizzle.db.execute<{
      latestSeq: string | null;
      expiredThroughSeq: string | null;
    }>(sql`
      SELECT latest_seq::text AS "latestSeq",
        expired_through_seq::text AS "expiredThroughSeq"
      FROM ${sql.identifier(schema)}.${sql.identifier('_rt_outbox_state')}
      WHERE table_name = ${tableName}
      LIMIT 1
    `);
    if (!result.rows[0]) return { latestSeq: '0', expiredThroughSeq: '0' };
    return {
      latestSeq: result.rows[0].latestSeq ?? '0',
      expiredThroughSeq: result.rows[0].expiredThroughSeq ?? '0',
    };
  }

  /** Returns the latest per-table cursor without using lossy JS numbers. */
  async currentCursor(projectId: string, tableName: string): Promise<string> {
    const schema = await this.assertRealtimeEnabled(projectId, tableName);
    const state = await this.readOutboxState(schema, tableName);
    return state.latestSeq;
  }

  /** Replays retained metadata events after a decimal bigint cursor. */
  async replay(projectId: string, tableName: string, since: string) {
    const schema = await this.assertRealtimeEnabled(projectId, tableName);
    if (!/^[0-9]{1,20}$/.test(since)) {
      throw new BadRequestException('Invalid realtime cursor');
    }
    const cursor = BigInt(since);
    if (cursor > 9_223_372_036_854_775_807n) {
      throw new BadRequestException('Invalid realtime cursor');
    }

    const maxRows = Math.min(
      this.getLimit('REALTIME_MAX_REPLAY_ROWS', 500),
      1000,
    );

    const result = await this.drizzle.db.execute<{
      latestSeq: string;
      expiredThroughSeq: string;
      seq: string | null;
      payload: Omit<RealtimeEvent, 'seq'> | null;
    }>(sql`
      WITH state AS MATERIALIZED (
        SELECT
          COALESCE((SELECT latest_seq::text FROM ${sql.identifier(schema)}.${sql.identifier('_rt_outbox_state')} WHERE table_name = ${tableName}), '0') AS "latestSeq",
          COALESCE((SELECT expired_through_seq::text FROM ${sql.identifier(schema)}.${sql.identifier('_rt_outbox_state')} WHERE table_name = ${tableName}), '0') AS "expiredThroughSeq"
      )
      SELECT state."latestSeq", state."expiredThroughSeq",
        events.seq::text AS seq, events.payload
      FROM state
      LEFT JOIN LATERAL (
        SELECT seq, payload
        FROM ${sql.identifier(schema)}.${sql.identifier('_rt_outbox')}
        WHERE table_name = ${tableName} AND seq > ${since}::bigint
        ORDER BY seq ASC
        LIMIT ${maxRows + 1}
      ) AS events ON TRUE
      ORDER BY events.seq ASC
    `);
    const state = result.rows[0];
    const latest = BigInt(state?.latestSeq ?? '0');
    const expiredThrough = BigInt(state?.expiredThroughSeq ?? '0');
    const latestCursor = state?.latestSeq ?? '0';
    if (cursor > latest) {
      throw new BadRequestException('Realtime cursor is ahead of the table');
    }
    if (cursor < expiredThrough) {
      return {
        gap: 'expired' as ReplayGap,
        cursor: latestCursor,
        replayed: 0,
        events: [] as RealtimeEvent[],
      };
    }

    const eventRows = result.rows.filter(
      (row): row is typeof row & { seq: string; payload: Omit<RealtimeEvent, 'seq'> } =>
        row.seq !== null && row.payload !== null,
    );
    if (eventRows.length > maxRows) {
      return {
        gap: 'expired' as ReplayGap,
        cursor: latestCursor,
        replayed: 0,
        events: [] as RealtimeEvent[],
      };
    }

    const events = eventRows.map(({ seq, payload }) => ({
      ...payload,
      seq,
    })) as RealtimeEvent[];
    const replayCursor = events.at(-1)?.seq ?? latestCursor;
    return {
      gap: events.length ? ('replayed' as ReplayGap) : ('none' as ReplayGap),
      cursor: replayCursor,
      replayed: events.length,
      events,
    };
  }

  private countSubscriptions(projectId?: string): number {
    let count = 0;
    for (const entry of this.listeners.values()) {
      if (!projectId || entry.projectId === projectId) {
        count += entry.subscriptions.size;
      }
    }
    return count;
  }

  private assertCapacity(projectId: string, entry?: ChannelEntry): void {
    const maxSubscriptions = this.getLimit('REALTIME_MAX_SUBSCRIPTIONS', 2000);
    const maxProjectSubscriptions = this.getLimit(
      'REALTIME_MAX_SUBSCRIPTIONS_PER_PROJECT',
      200,
    );
    const maxChannels = this.getLimit('REALTIME_MAX_CHANNELS', 200);

    if (this.countSubscriptions() >= maxSubscriptions) {
      throw new HttpException(
        'Realtime capacity reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (this.countSubscriptions(projectId) >= maxProjectSubscriptions) {
      throw new HttpException(
        'Project Realtime capacity reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      !entry &&
      this.listeners.size + this.closingEntries.size >= maxChannels
    ) {
      throw new HttpException(
        'Realtime channel capacity reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async subscribe(
    projectId: string,
    tableName: string,
    callback: (event: RealtimeEvent) => void,
    onStatus?: StatusCallback,
  ): Promise<void> {
    if (this.shuttingDown) {
      throw new ServiceUnavailableException('Realtime is shutting down');
    }
    await this.assertRealtimeEnabled(projectId, tableName);

    const channel = TriggerService.channelName(projectId, tableName);
    let entry = this.listeners.get(channel);
    if (!entry) {
      this.assertCapacity(projectId);
      entry = {
        channel,
        projectId,
        tableName,
        status: 'connecting',
        subscriptions: new Map(),
        retryAttempt: 0,
        closing: false,
        lastEmittedSeq: 0n,
      };
      // Reserve synchronously before the first await: concurrent subscribes
      // share this entry and cannot create duplicate database clients.
      this.listeners.set(channel, entry);
    } else if (!entry.subscriptions.has(callback)) {
      this.assertCapacity(projectId, entry);
    }

    entry.subscriptions.set(callback, { callback, onStatus });
    try {
      await this.connect(entry);
    } catch (error) {
      entry.subscriptions.delete(callback);
      if (entry.subscriptions.size === 0) await this.closeEntry(entry);
      throw error;
    }
  }

  private connect(entry: ChannelEntry): Promise<void> {
    if (entry.status === 'ready') return Promise.resolve();
    if (entry.connectPromise) return entry.connectPromise;
    if (entry.closing || this.shuttingDown) {
      return Promise.reject(
        new ServiceUnavailableException('Realtime is closing'),
      );
    }
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = undefined;
    }

    entry.status = 'connecting';
    const operation = this.openClient(entry);
    entry.connectPromise = operation;
    void operation
      .finally(() => {
        if (entry.connectPromise === operation)
          entry.connectPromise = undefined;
      })
      .catch(() => undefined);
    return operation;
  }

  private async openClient(entry: ChannelEntry): Promise<void> {
    const client = new Client({
      connectionString: this.getListenConnectionString(),
    });
    entry.client = client;

    client.on('notification', (message) => {
      if (
        entry.client !== client ||
        this.listeners.get(entry.channel) !== entry ||
        !message.payload
      )
        return;
      try {
        const event = JSON.parse(message.payload) as RealtimeEvent;
        if (
          event.projectId !== entry.projectId ||
          event.table !== entry.tableName ||
          !['INSERT', 'UPDATE', 'DELETE'].includes(event.type) ||
          typeof event.timestamp !== 'string' ||
          typeof event.seq !== 'string' ||
          !/^[0-9]{1,20}$/.test(event.seq)
        )
          return;
        const seq = BigInt(event.seq);
        if (seq <= entry.lastEmittedSeq) return;
        entry.lastEmittedSeq = seq;
        for (const subscription of entry.subscriptions.values()) {
          try {
            subscription.callback(event);
          } catch (error) {
            console.error('[realtime] event callback failed', error);
          }
        }
      } catch (error) {
        console.error(
          `[realtime] invalid notification on ${entry.channel}`,
          error,
        );
      }
    });

    client.on('error', (error) => {
      if (entry.client !== client || entry.closing) return;
      console.error(
        `[realtime] database listener failed on ${entry.channel}`,
        error,
      );
      void this.handleClientFailure(entry, client);
    });
    client.on('end', () => {
      if (entry.client === client && !entry.closing) {
        void this.handleClientFailure(entry, client);
      }
    });

    try {
      await client.connect();
      if (
        entry.closing ||
        entry.client !== client ||
        this.listeners.get(entry.channel) !== entry
      ) {
        await this.endClient(client);
        return;
      }
      await client.query(`LISTEN ${this.quoteIdentifier(entry.channel)}`);
      if (
        entry.closing ||
        entry.client !== client ||
        this.listeners.get(entry.channel) !== entry
      ) {
        await this.endClient(client);
        return;
      }
      entry.status = 'ready';
      entry.retryAttempt = 0;
      for (const subscription of entry.subscriptions.values()) {
        this.notifyStatus(subscription, 'connected');
      }
    } catch (error) {
      if (entry.client === client) entry.client = undefined;
      await this.endClient(client);
      if (!entry.closing) entry.status = 'retrying';
      throw error;
    }
  }

  private quoteIdentifier(identifier: string): string {
    // The channel is generated server-side from a fixed alphabet, but quote it
    // as an identifier as a defense in depth measure.
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private async handleClientFailure(
    entry: ChannelEntry,
    client: Client,
  ): Promise<void> {
    if (entry.client !== client || entry.closing) return;
    entry.client = undefined;
    entry.status = 'retrying';
    await this.endClient(client);
    if (entry.subscriptions.size === 0 || this.shuttingDown) return;

    for (const subscription of entry.subscriptions.values()) {
      this.notifyStatus(subscription, 'reconnecting');
    }
    if (entry.retryTimer) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(entry.retryAttempt, 6));
    entry.retryAttempt += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = undefined;
      if (entry.closing || this.listeners.get(entry.channel) !== entry) return;
      void this.connect(entry).catch((error: unknown) => {
        console.error(`[realtime] reconnect failed on ${entry.channel}`, error);
        this.scheduleRetry(entry);
      });
    }, delay);
    entry.retryTimer.unref?.();
  }

  private scheduleRetry(entry: ChannelEntry): void {
    if (entry.closing || this.shuttingDown || entry.retryTimer) return;
    if (entry.subscriptions.size === 0) {
      void this.closeEntry(entry);
      return;
    }
    const delay = Math.min(30_000, 500 * 2 ** Math.min(entry.retryAttempt, 6));
    entry.retryAttempt += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = undefined;
      void this.connect(entry).catch((error: unknown) => {
        console.error(`[realtime] reconnect failed on ${entry.channel}`, error);
        this.scheduleRetry(entry);
      });
    }, delay);
    entry.retryTimer.unref?.();
  }

  private notifyStatus(
    subscription: Subscription,
    status: 'reconnecting' | 'connected',
  ): void {
    try {
      subscription.onStatus?.(status);
    } catch (error) {
      console.error('[realtime] status callback failed', error);
    }
  }

  private async endClient(client: Client): Promise<void> {
    try {
      await client.end();
    } catch (error) {
      console.error('[realtime] failed to close database listener', error);
    }
  }

  async unsubscribe(
    projectId: string,
    tableName: string,
    callback: (event: RealtimeEvent) => void,
  ): Promise<void> {
    const channel = TriggerService.channelName(projectId, tableName);
    const entry = this.listeners.get(channel);
    if (!entry) return;
    entry.subscriptions.delete(callback);
    if (entry.subscriptions.size === 0) await this.closeEntry(entry);
  }

  private async closeEntry(entry: ChannelEntry): Promise<void> {
    if (entry.closePromise) return entry.closePromise;
    const wasReady = entry.status === 'ready';
    entry.closing = true;
    entry.status = 'closing';
    this.closingEntries.add(entry);
    if (this.listeners.get(entry.channel) === entry) {
      this.listeners.delete(entry.channel);
    }
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.retryTimer = undefined;

    const operation = (async () => {
      const client = entry.client;
      entry.client = undefined;
      if (client) {
        try {
          if (wasReady) {
            await client.query(
              `UNLISTEN ${this.quoteIdentifier(entry.channel)}`,
            );
          }
        } catch (error) {
          console.error(
            `[realtime] UNLISTEN failed on ${entry.channel}`,
            error,
          );
        } finally {
          await this.endClient(client);
        }
      }
      // If initialization is in flight, it observes closing/map identity and
      // closes its client before resolving.
      await entry.connectPromise?.catch(() => undefined);
    })();
    entry.closePromise = operation;
    try {
      await operation;
    } finally {
      this.closingEntries.delete(entry);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    await Promise.allSettled(
      [...this.listeners.values(), ...this.closingEntries].map((entry) =>
        this.closeEntry(entry),
      ),
    );
    this.listeners.clear();
  }
}
