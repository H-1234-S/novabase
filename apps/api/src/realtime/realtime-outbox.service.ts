import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { DrizzleService } from '../db/drizzle.service.js';
import { projects } from '../db/schema/index.js';
import { TriggerService } from './trigger.service.js';

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const DELETE_BATCH_SIZE = 1000;
const MAX_BATCHES_PER_SCHEMA = 10;

@Injectable()
export class RealtimeOutboxService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private cleanupPromise?: Promise<void>;

  constructor(
    private drizzle: DrizzleService,
    private config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.cleanup().catch((error: unknown) => {
        console.error('[realtime] outbox cleanup failed', error);
      });
    }, CLEANUP_INTERVAL_MS);
    this.timer.unref?.();
    void this.cleanup().catch((error: unknown) => {
      console.error('[realtime] initial outbox cleanup failed', error);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.cleanupPromise;
  }

  private cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    const operation = this.cleanupExpiredRows();
    this.cleanupPromise = operation;
    void operation.finally(() => {
      if (this.cleanupPromise === operation) this.cleanupPromise = undefined;
    }).catch(() => undefined);
    return operation;
  }

  private getRetentionHours(): number {
    const configured = Number(
      this.config.get<string>('REALTIME_OUTBOX_RETENTION_HOURS'),
    );
    return Number.isSafeInteger(configured) && configured > 0
      ? configured
      : 24;
  }

  private async cleanupExpiredRows(): Promise<void> {
    const projectSchemas = await this.drizzle.db
      .select({ dbSchema: projects.dbSchema })
      .from(projects);
    const retentionHours = this.getRetentionHours();

    for (const { dbSchema } of projectSchemas) {
      TriggerService.assertIdentifier(dbSchema, 'schema name');
      const exists = await this.drizzle.db.execute<{ exists: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = ${dbSchema} AND table_name = '_rt_outbox'
        ) AS exists
      `);
      if (!exists.rows[0]?.exists) continue;

      const schema = sql.identifier(dbSchema);
      const stateTable = sql.identifier('_rt_outbox_state');
      await this.drizzle.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${schema}.${stateTable} (
          table_name TEXT PRIMARY KEY,
          latest_seq BIGINT NOT NULL DEFAULT 0,
          expired_through_seq BIGINT NOT NULL DEFAULT 0
        )
      `);

      for (let batch = 0; batch < MAX_BATCHES_PER_SCHEMA; batch += 1) {
        const result = await this.drizzle.db.execute<{
          acquired: boolean;
          deleted: number;
        }>(sql`
          WITH lock_attempt AS MATERIALIZED (
            SELECT pg_try_advisory_xact_lock(1314274913, 1380011876) AS acquired
          ), deleted AS (
            DELETE FROM ${schema}.${sql.identifier('_rt_outbox')}
            WHERE ctid IN (
              SELECT ctid
              FROM ${schema}.${sql.identifier('_rt_outbox')}
              WHERE created_at < now() - make_interval(hours => ${retentionHours})
              ORDER BY created_at
              LIMIT ${DELETE_BATCH_SIZE}
            )
            AND (SELECT acquired FROM lock_attempt)
            RETURNING seq
          )
          SELECT acquired, (SELECT count(*)::int FROM deleted) AS deleted
          FROM lock_attempt
        `);
        const outcome = result.rows[0];
        if (!outcome?.acquired || outcome.deleted < DELETE_BATCH_SIZE) break;
      }
    }
  }
}
