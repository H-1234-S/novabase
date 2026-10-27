import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { DrizzleService } from '../db/drizzle.service.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_IDENTIFIER_BYTES = 63;

@Injectable()
export class TriggerService {
  constructor(private drizzle: DrizzleService) {}

  static assertIdentifier(
    name: unknown,
    label: string,
  ): asserts name is string {
    if (
      typeof name !== 'string' ||
      !IDENTIFIER.test(name) ||
      Buffer.byteLength(name, 'utf8') > MAX_IDENTIFIER_BYTES
    ) {
      throw new BadRequestException(`Invalid ${label}`);
    }
  }

  static assertTableIdentifier(name: unknown): asserts name is string {
    TriggerService.assertIdentifier(name, 'table name');
    if (name.startsWith('_rt_')) {
      throw new BadRequestException('Realtime internal tables are reserved');
    }
  }

  private static hash(projectId: string, tableName: string): string {
    return createHash('sha256')
      .update(`${projectId}\0${tableName}`)
      .digest('hex')
      .slice(0, 32);
  }

  static channelName(projectId: string, tableName: string): string {
    return `rt_${TriggerService.hash(projectId, tableName)}`;
  }

  static functionName(projectId: string, tableName: string): string {
    return `rt_fn_${TriggerService.hash(projectId, tableName)}`;
  }

  static triggerName(projectId: string, tableName: string): string {
    return `rt_tr_${TriggerService.hash(projectId, tableName)}`;
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  async enableRealtime(
    dbSchema: string,
    projectId: string,
    tableName: string,
  ): Promise<void> {
    TriggerService.assertIdentifier(dbSchema, 'schema name');
    TriggerService.assertTableIdentifier(tableName);

    const channel = TriggerService.channelName(projectId, tableName);
    const fnName = TriggerService.functionName(projectId, tableName);
    const triggerName = TriggerService.triggerName(projectId, tableName);
    const schema = this.quoteIdentifier(dbSchema);
    const table = this.quoteIdentifier(tableName);
    const fn = this.quoteIdentifier(fnName);
    const trigger = this.quoteIdentifier(triggerName);
    const outbox = this.quoteIdentifier('_rt_outbox');
    const outboxState = this.quoteIdentifier('_rt_outbox_state');
    const outboxIndex = this.quoteIdentifier('_rt_outbox_table_seq_idx');
    const expiryFunction = this.quoteIdentifier('_rt_outbox_mark_expired');
    const expiryTrigger = this.quoteIdentifier('_rt_outbox_expiry_trigger');

    await this.drizzle.db.execute(`
      CREATE TABLE IF NOT EXISTS ${schema}.${outbox} (
        seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        table_name TEXT NOT NULL,
        op TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await this.drizzle.db.execute(`
      CREATE INDEX IF NOT EXISTS ${outboxIndex}
      ON ${schema}.${outbox} (table_name, seq)
    `);
    await this.drizzle.db.execute(`
      CREATE TABLE IF NOT EXISTS ${schema}.${outboxState} (
        table_name TEXT PRIMARY KEY,
        latest_seq BIGINT NOT NULL DEFAULT 0,
        expired_through_seq BIGINT NOT NULL DEFAULT 0
      )
    `);
    await this.drizzle.db.execute(`
      CREATE OR REPLACE FUNCTION ${schema}.${expiryFunction}()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO ${schema}.${outboxState} (table_name, expired_through_seq)
        VALUES (OLD.table_name, OLD.seq)
        ON CONFLICT (table_name) DO UPDATE
          SET expired_through_seq = GREATEST(
            ${outboxState}.expired_through_seq,
            EXCLUDED.expired_through_seq
          );
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await this.drizzle.db.execute(`
      DO $$
      BEGIN
        CREATE TRIGGER ${expiryTrigger}
        AFTER DELETE ON ${schema}.${outbox}
        FOR EACH ROW EXECUTE FUNCTION ${schema}.${expiryFunction}();
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;
      $$;
    `);

    await this.drizzle.db.execute(`
      CREATE OR REPLACE FUNCTION ${schema}.${fn}()
      RETURNS TRIGGER AS $$
      DECLARE
        v_seq BIGINT;
        v_payload JSONB;
      BEGIN
        -- Serialize sequence allocation and commit order for this table.
        PERFORM pg_advisory_xact_lock(
          hashtextextended(${this.quoteLiteral(`${projectId}:`)} || TG_TABLE_NAME, 0)
        );

        v_payload = jsonb_build_object(
          'version', 1,
          'type', TG_OP,
          'table', TG_TABLE_NAME,
          'record', NULL,
          'projectId', ${this.quoteLiteral(projectId)},
          'timestamp', clock_timestamp()::text
        );

        INSERT INTO ${schema}.${outbox} (table_name, op, payload)
        VALUES (TG_TABLE_NAME, TG_OP, v_payload)
        RETURNING seq INTO v_seq;

        INSERT INTO ${schema}.${outboxState} (table_name, latest_seq)
        VALUES (TG_TABLE_NAME, v_seq)
        ON CONFLICT (table_name) DO UPDATE
          SET latest_seq = GREATEST(${outboxState}.latest_seq, EXCLUDED.latest_seq);

        PERFORM pg_notify(
          ${this.quoteLiteral(channel)},
          (v_payload || jsonb_build_object('seq', v_seq::text))::text
        );
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create the replacement before removing the legacy trigger so a failure
    // on the new DDL does not leave the table without any realtime trigger.
    const legacyTrigger = this.quoteIdentifier(`${tableName}_realtime_trigger`);
    await this.drizzle.db.execute(`
      DO $$
      BEGIN
        CREATE TRIGGER ${trigger}
        AFTER INSERT OR UPDATE OR DELETE ON ${schema}.${table}
        FOR EACH ROW EXECUTE FUNCTION ${schema}.${fn}();
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;
      $$;
    `);
    // The legacy name is needed for an in-place rollout from old builds.
    await this.drizzle.db.execute(
      `DROP TRIGGER IF EXISTS ${legacyTrigger} ON ${schema}.${table}`,
    );
  }

  async disableRealtime(
    dbSchema: string,
    projectId: string,
    tableName: string,
  ): Promise<void> {
    TriggerService.assertIdentifier(dbSchema, 'schema name');
    TriggerService.assertTableIdentifier(tableName);

    const schema = this.quoteIdentifier(dbSchema);
    const table = this.quoteIdentifier(tableName);
    const trigger = this.quoteIdentifier(
      TriggerService.triggerName(projectId, tableName),
    );
    const legacyTrigger = this.quoteIdentifier(`${tableName}_realtime_trigger`);

    await this.drizzle.db.execute(
      `DROP TRIGGER IF EXISTS ${trigger} ON ${schema}.${table}`,
    );
    await this.drizzle.db.execute(
      `DROP TRIGGER IF EXISTS ${legacyTrigger} ON ${schema}.${table}`,
    );
  }
}
