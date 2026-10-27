import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const state = vi.hoisted(() => ({
  clients: [] as Array<any>,
  failNextConnect: false,
  failNextListen: false,
  enabled: true,
  holdConnect: false,
  pendingConnects: [] as Array<() => void>,
}));

vi.mock('@neondatabase/serverless', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeClient extends EventEmitter {
    connect = vi.fn(async () => {
      if (state.failNextConnect) {
        state.failNextConnect = false;
        throw new Error('connect failed');
      }
      if (state.holdConnect) {
        await new Promise<void>((resolve) =>
          state.pendingConnects.push(resolve),
        );
      }
    });
    query = vi.fn(async (statement: string) => {
      if (state.failNextListen && statement.startsWith('LISTEN ')) {
        state.failNextListen = false;
        throw new Error('listen failed');
      }
    });
    end = vi.fn(async () => undefined);

    constructor() {
      super();
      state.clients.push(this);
    }
  }
  return { Client: FakeClient, neonConfig: {} };
});

import { RealtimeService } from './realtime.service.js';
import { TriggerService } from './trigger.service.js';

const projectId = '9b5bfc38-60d6-4f35-93cc-649142e48ad4';

function createService() {
  const drizzle = {
    db: {
      execute: vi.fn(async (statement: any) => {
        const query = new PgDialect().sqlToQuery(statement).sql;
        if (query.includes('information_schema.triggers')) {
          return {
            rows: [{ dbSchema: 'proj_test', enabled: state.enabled }],
          };
        }
        if (query.includes('_rt_outbox_state')) {
          return { rows: [{ latestSeq: '20', expiredThroughSeq: '0' }] };
        }
        if (query.includes('_rt_outbox')) return { rows: [] };
        throw new Error(`Unexpected query: ${query}`);
      }),
    },
  };
  const config = {
    get: (key: string) =>
      key === 'DATABASE_URL' ? 'postgresql://localhost/test' : undefined,
  };
  return new RealtimeService(config as never, drizzle as never);
}

describe('RealtimeService', () => {
  beforeEach(() => {
    state.clients.length = 0;
    state.failNextConnect = false;
    state.failNextListen = false;
    state.enabled = true;
    state.holdConnect = false;
    state.pendingConnects.length = 0;
  });

  it('shares one in-flight connection for concurrent subscriptions to a channel', async () => {
    const service = createService();
    const first = vi.fn();
    const second = vi.fn();

    state.holdConnect = true;
    const firstSubscribe = service.subscribe(projectId, 'posts', first);
    const secondSubscribe = service.subscribe(projectId, 'posts', second);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].connect).toHaveBeenCalledTimes(1);
    state.holdConnect = false;
    state.pendingConnects.splice(0).forEach((resolve) => resolve());
    await Promise.all([firstSubscribe, secondSubscribe]);
    expect(state.clients[0].query).toHaveBeenCalledTimes(1);
    expect(state.clients[0].query).toHaveBeenCalledWith(
      `LISTEN "${TriggerService.channelName(projectId, 'posts')}"`,
    );

    state.clients[0].emit('notification', {
      payload: JSON.stringify({
        version: 1,
        seq: '1',
        type: 'INSERT',
        table: 'posts',
        record: null,
        projectId,
        timestamp: new Date().toISOString(),
      }),
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    await service.unsubscribe(projectId, 'posts', first);
    expect(state.clients[0].end).not.toHaveBeenCalled();
    await service.unsubscribe(projectId, 'posts', second);
    expect(state.clients[0].query).toHaveBeenLastCalledWith(
      `UNLISTEN "${TriggerService.channelName(projectId, 'posts')}"`,
    );
    expect(state.clients[0].end).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe names and tables without an enabled trigger before opening a client', async () => {
    const service = createService();
    await expect(
      service.subscribe(projectId, 'posts; SELECT 1', vi.fn()),
    ).rejects.toThrow();
    state.enabled = false;
    await expect(
      service.subscribe(projectId, 'missing', vi.fn()),
    ).rejects.toThrow();
    expect(state.clients).toHaveLength(0);
  });

  it('closes a client when initial connection fails', async () => {
    const service = createService();
    const callback = vi.fn();
    state.failNextConnect = true;
    await expect(
      service.subscribe(projectId, 'posts', callback),
    ).rejects.toThrow('connect failed');
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].end).toHaveBeenCalledTimes(1);
  });

  it('closes a connected client when LISTEN fails', async () => {
    const service = createService();
    state.failNextListen = true;
    await expect(
      service.subscribe(projectId, 'posts', vi.fn()),
    ).rejects.toThrow('listen failed');
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].end).toHaveBeenCalledTimes(1);
  });

  it('recreates a failed listener with capped backoff and notifies subscribers', async () => {
    vi.useFakeTimers();
    try {
      const service = createService();
      const statuses: string[] = [];
      const callback = vi.fn();
      await service.subscribe(projectId, 'posts', callback, (status) =>
        statuses.push(status),
      );

      state.clients[0].emit('error', new Error('socket closed'));
      await vi.advanceTimersByTimeAsync(500);

      expect(state.clients).toHaveLength(2);
      expect(state.clients[1].query).toHaveBeenCalledWith(
        `LISTEN "${TriggerService.channelName(projectId, 'posts')}"`,
      );
      expect(statuses).toEqual(['connected', 'reconnecting', 'connected']);
      await service.unsubscribe(projectId, 'posts', callback);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays only events after the cursor in ascending bigint order', async () => {
    const drizzle = {
      db: {
        execute: vi.fn(async (statement: any) => {
          const query = new PgDialect().sqlToQuery(statement).sql;
          if (query.includes('information_schema.triggers')) {
            return { rows: [{ dbSchema: 'proj_test', enabled: true }] };
          }
          if (query.includes('LEFT JOIN LATERAL')) {
            return {
              rows: [
                {
                  latestSeq: '9007199254741000',
                  expiredThroughSeq: '0',
                  seq: '9007199254740994',
                  payload: { type: 'UPDATE' },
                },
                {
                  latestSeq: '9007199254741000',
                  expiredThroughSeq: '0',
                  seq: '9007199254740999',
                  payload: { type: 'DELETE' },
                },
              ],
            };
          }
          if (query.includes('_rt_outbox_state')) {
            return { rows: [{ latestSeq: '9007199254741000', expiredThroughSeq: '0' }] };
          }
          throw new Error(`Unexpected query: ${query}`);
        }),
      },
    };
    const service = new RealtimeService(
      { get: () => undefined } as never,
      drizzle as never,
    );

    const result = await service.replay(
      projectId,
      'posts',
      '9007199254740993',
    );

    expect(result).toMatchObject({
      gap: 'replayed',
      cursor: '9007199254740999',
      events: [
        { seq: '9007199254740994', type: 'UPDATE' },
        { seq: '9007199254740999', type: 'DELETE' },
      ],
    });
  });

  it('marks replay expired using the per-table deletion watermark', async () => {
    const drizzle = {
      db: {
        execute: vi.fn(async (statement: any) => {
          const query = new PgDialect().sqlToQuery(statement).sql;
          if (query.includes('information_schema.triggers')) {
            return { rows: [{ dbSchema: 'proj_test', enabled: true }] };
          }
          if (query.includes('LEFT JOIN LATERAL')) {
            return {
              rows: [
                {
                  latestSeq: '40',
                  expiredThroughSeq: '15',
                  seq: null,
                  payload: null,
                },
              ],
            };
          }
          if (query.includes('_rt_outbox_state')) {
            return { rows: [{ latestSeq: '9007199254741000', expiredThroughSeq: '0' }] };
          }
          throw new Error(`Unexpected query: ${query}`);
        }),
      },
    };
    const service = new RealtimeService(
      { get: () => undefined } as never,
      drizzle as never,
    );

    const result = await service.replay(projectId, 'posts', '12');

    expect(result).toMatchObject({
      gap: 'expired',
      cursor: '40',
      events: [],
    });
  });

  it('marks replay expired when the result exceeds the configured cap', async () => {
    const drizzle = {
      db: {
        execute: vi.fn(async (statement: any) => {
          const query = new PgDialect().sqlToQuery(statement).sql;
          if (query.includes('information_schema.triggers')) {
            return { rows: [{ dbSchema: 'proj_test', enabled: true }] };
          }
          if (query.includes('_rt_outbox_state')) {
            return {
              rows: Array.from({ length: 3 }, (_, index) => ({
                latestSeq: '9',
                expiredThroughSeq: '0',
                seq: String(index + 1),
                payload: { type: 'INSERT' },
              })),
            };
          }
          throw new Error(`Unexpected query: ${query}`);
        }),
      },
    };
    const service = new RealtimeService(
      { get: (key: string) => key === 'REALTIME_MAX_REPLAY_ROWS' ? '2' : undefined } as never,
      drizzle as never,
    );

    const result = await service.replay(projectId, 'posts', '0');

    expect(result).toMatchObject({ gap: 'expired', cursor: '9', events: [] });
  });
});
