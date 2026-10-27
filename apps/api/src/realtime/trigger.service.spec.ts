import { describe, expect, it } from 'vitest';
import { TriggerService } from './trigger.service.js';

const projectId = '9b5bfc38-60d6-4f35-93cc-649142e48ad4';

describe('TriggerService', () => {
  it('uses bounded, distinct internal identifiers for long table names', () => {
    const prefix = 'a'.repeat(60);
    const first = TriggerService.channelName(projectId, `${prefix}x`);
    const second = TriggerService.channelName(projectId, `${prefix}y`);
    expect(first).not.toBe(second);
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(63);
    expect(
      Buffer.byteLength(TriggerService.functionName(projectId, prefix)),
    ).toBeLessThanOrEqual(63);
    expect(
      Buffer.byteLength(TriggerService.triggerName(projectId, prefix)),
    ).toBeLessThanOrEqual(63);
  });

  it('creates a transactional outbox before the trigger and notifies its seq', async () => {
    const statements: string[] = [];
    const service = new TriggerService({
      db: {
        execute: async (statement: string) => {
          statements.push(statement);
        },
      },
    } as never);

    await service.enableRealtime('proj_test', projectId, 'posts');

    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS');
    expect(statements[0]).toContain('"_rt_outbox"');
    expect(statements.some((statement) => statement.includes('"_rt_outbox_state"'))).toBe(true);
    const functionDdl = statements.find((statement) =>
      statement.includes(
        `CREATE OR REPLACE FUNCTION "proj_test"."${TriggerService.functionName(projectId, 'posts')}"`,
      ),
    );
    expect(functionDdl).toContain('pg_advisory_xact_lock');
    expect(functionDdl).toContain('INSERT INTO "proj_test"."_rt_outbox"');
    expect(functionDdl).toContain('RETURNING seq INTO v_seq');
    expect(functionDdl).toContain("'seq', v_seq::text");
    expect(functionDdl).toContain("'record', NULL");
    expect(functionDdl).not.toContain('row_to_json');
    const createTrigger = statements.find((statement) =>
      statement.includes('CREATE TRIGGER') &&
      statement.includes(TriggerService.functionName(projectId, 'posts')),
    );
    expect(createTrigger).toContain(
      TriggerService.functionName(projectId, 'posts'),
    );
    expect(
      statements.findIndex((statement) => statement.includes('CREATE TRIGGER')),
    ).toBeLessThan(
      statements.findIndex((statement) => statement.includes('DROP TRIGGER')),
    );
  });

  it('rejects unsafe schema and table identifiers before issuing DDL', async () => {
    const execute = async () => undefined;
    const service = new TriggerService({ db: { execute } } as never);

    await expect(
      service.enableRealtime('proj_test', projectId, 'posts; DROP TABLE users'),
    ).rejects.toThrow();
  });
});
