import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { RealtimeOutboxService } from './realtime-outbox.service.js';

describe('RealtimeOutboxService', () => {
  it('cleans old rows in a bounded statement protected by a transaction lock', async () => {
    const statements: string[] = [];
    const drizzle = {
      db: {
        select: () => ({
          from: () => Promise.resolve([{ dbSchema: 'proj_test' }]),
        }),
        execute: vi.fn(async (statement: any) => {
          const query = new PgDialect().sqlToQuery(statement).sql;
          statements.push(query);
          if (query.includes('information_schema.tables')) {
            return { rows: [{ exists: true }] };
          }
          if (query.includes('pg_try_advisory_xact_lock')) {
            return { rows: [{ acquired: true, deleted: 0 }] };
          }
          return { rows: [] };
        }),
      },
    };
    const service = new RealtimeOutboxService(
      drizzle as never,
      { get: () => '24' } as never,
    );

    await service['cleanupExpiredRows']();

    const deleteBatch = statements.find((statement) =>
      statement.includes('pg_try_advisory_xact_lock'),
    );
    expect(deleteBatch).toContain('ctid IN');
    expect(deleteBatch).toContain('LIMIT');
    expect(deleteBatch).toContain('make_interval(hours =>');
    expect(deleteBatch).toContain('"proj_test"."_rt_outbox"');
  });

  it('does not delete rows when another instance owns the advisory lock', async () => {
    const drizzle = {
      db: {
        select: () => ({
          from: () => Promise.resolve([{ dbSchema: 'proj_test' }]),
        }),
        execute: vi.fn(async (statement: any) => {
          const query = new PgDialect().sqlToQuery(statement).sql;
          if (query.includes('information_schema.tables')) {
            return { rows: [{ exists: true }] };
          }
          if (query.includes('pg_try_advisory_xact_lock')) {
            return { rows: [{ acquired: false, deleted: 0 }] };
          }
          return { rows: [] };
        }),
      },
    };
    const service = new RealtimeOutboxService(
      drizzle as never,
      { get: () => undefined } as never,
    );

    await service['cleanupExpiredRows']();

    expect(drizzle.db.execute).toHaveBeenCalledTimes(3);
  });
});
