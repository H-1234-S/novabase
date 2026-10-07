import { BadRequestException, Injectable } from '@nestjs/common';
import { DrizzleService } from '../db/drizzle.service.js';

@Injectable()
export class TriggerService {
  constructor(private drizzle: DrizzleService) {}

  private assertSafeIdentifier(name: string, label: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new BadRequestException(`Invalid ${label}: ${name}`);
    }
  }

  // 构造频道名
  static channelName(projectId: string, tableName: string): string {
    return `project_${projectId.replace(/-/g, '_')}_${tableName}`;
  }

  async enableRealtime(
    dbSchema: string,
    projectId: string,
    tableName: string,
  ): Promise<void> {
    this.assertSafeIdentifier(dbSchema, 'schema name');
    this.assertSafeIdentifier(tableName, 'table name');

    const channel = TriggerService.channelName(projectId, tableName);
    const fnName = `${tableName}_notify`;

    // 构造通知函数
    await this.drizzle.db.execute(`
      CREATE OR REPLACE FUNCTION "${dbSchema}"."${fnName}"()
      RETURNS TRIGGER AS $$
      DECLARE
        payload JSON;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          payload = json_build_object(
            'type', TG_OP,
            'table', TG_TABLE_NAME,
            'record', row_to_json(OLD),
            'oldRecord', row_to_json(OLD),
            'projectId', '${projectId}',
            'timestamp', now()::text
          );
          PERFORM pg_notify('${channel}', payload::text);
          RETURN OLD;
        ELSIF TG_OP = 'UPDATE' THEN
          payload = json_build_object(
            'type', TG_OP,
            'table', TG_TABLE_NAME,
            'record', row_to_json(NEW),
            'oldRecord', row_to_json(OLD),
            'projectId', '${projectId}',
            'timestamp', now()::text
          );
          PERFORM pg_notify('${channel}', payload::text);
          RETURN NEW;
        ELSE
          payload = json_build_object(
            'type', TG_OP,
            'table', TG_TABLE_NAME,
            'record', row_to_json(NEW),
            'projectId', '${projectId}',
            'timestamp', now()::text
          );
          PERFORM pg_notify('${channel}', payload::text);
          RETURN NEW;
        END IF;
      END;
      $$ LANGUAGE plpgsql;
    `);
    // pg_notify(频道名, 消息文本) 是 PostgreSQL 的内置广播
    // 任何执行了 LISTEN "频道名" 的连接都会立刻收到这条消息

    // 重新创建触发器前先删掉同名的
    await this.drizzle.db.execute(`
      DROP TRIGGER IF EXISTS "${tableName}_realtime_trigger"
      ON "${dbSchema}"."${tableName}";
    `);

    // 将函数绑定到表上，每触发一次就执行一次
    await this.drizzle.db.execute(`
      CREATE TRIGGER "${tableName}_realtime_trigger"
      AFTER INSERT OR UPDATE OR DELETE
      ON "${dbSchema}"."${tableName}"
      FOR EACH ROW
      EXECUTE FUNCTION "${dbSchema}"."${fnName}"();
    `);
  }

  // 关闭实时功能
  async disableRealtime(dbSchema: string, tableName: string): Promise<void> {
    this.assertSafeIdentifier(dbSchema, 'schema name');
    this.assertSafeIdentifier(tableName, 'table name');

    await this.drizzle.db.execute(`
      DROP TRIGGER IF EXISTS "${tableName}_realtime_trigger"
      ON "${dbSchema}"."${tableName}";
    `);
  }
}
