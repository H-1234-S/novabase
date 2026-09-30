import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  FullQueryResults,
  NeonQueryFunction,
} from '@neondatabase/serverless';
import { and, desc, eq } from 'drizzle-orm';
import { DrizzleService } from '../db/drizzle.service.js';
import { projects, organizations, queryHistory } from '../db/schema/index.js';
import type { QueryResult } from '@novabase/types';

@Injectable()
export class SqlEditorService {
  constructor(private drizzle: DrizzleService) {}

  private assertSafeIdentifier(name: string, label: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new BadRequestException(`Invalid ${label}: ${name}`);
    }
  }

  private parseSingleStatement(querySql: string): string {
    const statements = querySql
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (statements.length === 0) {
      throw new BadRequestException('SQL query cannot be empty');
    }

    if (statements.length > 1) {
      throw new BadRequestException(
        'Only one SQL statement per run. Remove extra statements after a semicolon (e.g. a trailing SELECT).',
      );
    }

    return statements[0];
  }

  private getNeonClient(): NeonQueryFunction<false, true> {
    // this.drizzle.db 是 Drizzle ORM 实例
    // .$client 是底下真正的 Neon HTTP 查询函数
    const client = (
      this.drizzle.db as unknown as {
        $client: NeonQueryFunction<false, true>;
      }
    ).$client;

    if (!client?.transaction) {
      throw new Error('Neon HTTP client is not available');
    }

    return client;
  }

  // 规范执行结果
  private normalizePgResult(result: FullQueryResults<false>): {
    rows: Record<string, unknown>[];
    rowCount: number;
    command: string;
  } {
    const rows = (result.rows ?? []) as Record<string, unknown>[];

    return {
      rows,
      rowCount: result.rowCount ?? rows.length,
      command: result.command ?? 'SELECT',
    };
  }

  private async getProject(orgSlug: string, projectSlug: string) {
    const [row] = await this.drizzle.db
      .select({
        id: projects.id,
        dbSchema: projects.dbSchema,
      })
      .from(projects)
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .where(
        and(eq(organizations.slug, orgSlug), eq(projects.slug, projectSlug)),
      )
      .limit(1);

    if (!row) throw new NotFoundException('Project not found');
    return row;
  }

  // 执行 SQL 语句
  async executeQuery(
    orgSlug: string,
    projectSlug: string,
    querySql: string,
  ): Promise<QueryResult> {
    const project = await this.getProject(orgSlug, projectSlug);
    // 解析第一行 SQL 语句
    const statement = this.parseSingleStatement(querySql);

    const normalised = statement.trim().toUpperCase();
    // SQL 语句黑名单
    const blocked = ['DROP DATABASE', 'DROP SCHEMA', 'TRUNCATE'];

    if (blocked.some((b) => normalised.startsWith(b))) {
      throw new BadRequestException('This statement is not allowed');
    }

    this.assertSafeIdentifier(project.dbSchema, 'project schema');

    // 起始执行时间
    const start = Date.now();

    // 调用第三方 Neon 服务执行 SQL
    try {
      const neonSql = this.getNeonClient();

      // transaction 事物要么全成功要么全失败
      const results = await neonSql.transaction(
        (txn) => [
          // 设置本地查询路径
          txn`SET LOCAL search_path TO ${txn.unsafe(`"${project.dbSchema}", public`)}`,
          // 执行用户输入的任意 SQL
          txn`${txn.unsafe(statement)}`,
        ],
        { fullResults: true, readOnly: false },
      );

      const executionTimeMs = Date.now() - start;
      const { rows, rowCount, command } = this.normalizePgResult(
        results[results.length - 1],
      );
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      await this.drizzle.db.insert(queryHistory).values({
        projectId: project.id,
        sql: querySql,
        executionTimeMs,
        rowCount,
      });

      return {
        rows,
        columns,
        rowCount,
        executionTimeMs,
        command,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Query failed';
      throw new BadRequestException(message);
    }
  }

  // 获取历史执行记录
  async getHistory(orgSlug: string, projectSlug: string) {
    const project = await this.getProject(orgSlug, projectSlug);

    return this.drizzle.db
      .select()
      .from(queryHistory)
      .where(eq(queryHistory.projectId, project.id))
      .orderBy(desc(queryHistory.createdAt))
      .limit(50);
  }
}
