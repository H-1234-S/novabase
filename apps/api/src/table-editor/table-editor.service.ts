import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DrizzleService } from '../db/drizzle.service.js';
import { projects, organizations } from '../db/schema/index.js';
import { CreateTableDto } from './dto/create-table.dto.js';
import { AddColumnDto } from './dto/alter-table.dto.js';
import type { TableInfo, TableColumn, ColumnType } from '@novabase/types';

@Injectable()
export class TableEditorService {
  constructor(private drizzle: DrizzleService) {}

  // 防 SQL 注入函数
  // 在拼接任何含用户可控标识符的 SQL 之前，都会先校验
  private assertSafeIdentifier(name: string, label: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new BadRequestException(`Invalid ${label}: ${name}`);
    }
  }

  // 数据库类型映射列类型
  private mapPgTypeToColumnType(pgType: string): ColumnType {
    const map: Record<string, ColumnType> = {
      text: 'text',
      'character varying': 'text',
      integer: 'integer',
      bigint: 'bigint',
      boolean: 'boolean',
      'timestamp with time zone': 'timestamp',
      'timestamp without time zone': 'timestamp',
      uuid: 'uuid',
      jsonb: 'jsonb',
      numeric: 'numeric',
    };
    return map[pgType] ?? 'text';
  }

  private mapType(type: string): string {
    const map: Record<string, string> = {
      text: 'TEXT',
      integer: 'INTEGER',
      bigint: 'BIGINT',
      boolean: 'BOOLEAN',
      timestamp: 'TIMESTAMPTZ',
      uuid: 'UUID',
      jsonb: 'JSONB',
      numeric: 'NUMERIC',
    };
    return map[type] ?? 'TEXT';
  }

  private formatDefault(value: string, type: ColumnType): string {
    const trimmed = value.trim();
    if (!trimmed) return '';

    // 只匹配 now() current_timestamp gen_random_uuid()
    // i 表示大小写不敏感
    // 防 SQL 注入
    if (/^(now\(\)|gen_random_uuid\(\)|current_timestamp)$/i.test(trimmed)) {
      return trimmed;
    }
    if (type === 'boolean') return trimmed;
    if (type === 'integer' || type === 'bigint' || type === 'numeric') {
      return trimmed;
    }
    // ::jsonb Postgres 类型强转，把文本转为 jsonb 类型
    if (type === 'jsonb') return `'${trimmed.replace(/'/g, "''")}'::jsonb`;
    return `'${trimmed.replace(/'/g, "''")}'`;
  }

  private async getProjectSchema(
    orgSlug: string,
    projectSlug: string,
  ): Promise<string> {
    const [row] = await this.drizzle.db
      .select({ dbSchema: projects.dbSchema })
      .from(projects)
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .where(
        and(eq(organizations.slug, orgSlug), eq(projects.slug, projectSlug)),
      )
      .limit(1);

    if (!row) throw new NotFoundException('Project not found');
    return row.dbSchema;
  }

  // 表列表
  async getTables(orgSlug: string, projectSlug: string): Promise<string[]> {
    const schema = await this.getProjectSchema(orgSlug, projectSlug);

    // execute 为 drizzle 执行原生 SQL 方式
    // information_schema.tables 查系统表
    // table_schema = '${schema}' 属于该 Schema 的表
    const result = await this.drizzle.db.execute<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = '${schema}'
         AND table_type = 'BASE TABLE'
       ORDER BY table_name ASC`,
    );

    // 返回一个表名组成的数组
    return result.rows.map((r) => r.table_name);
  }

  // 获取表信息
  async getTableInfo(
    orgSlug: string,
    projectSlug: string,
    tableName: string,
  ): Promise<TableInfo> {
    this.assertSafeIdentifier(tableName, 'table name');
    const schema = await this.getProjectSchema(orgSlug, projectSlug);

    // 获取列信息
    const columnsResult = await this.drizzle.db.execute<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = '${schema}'
         AND table_name = '${tableName}'
       ORDER BY ordinal_position ASC`,
    );

    // 查询指定 schema + 指定表名，获取该表所有主键列名称
    const pkResult = await this.drizzle.db.execute<{ column_name: string }>(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = '${schema}'
         AND tc.table_name = '${tableName}'`,
    );

    const pkColumns = new Set(pkResult.rows.map((r) => r.column_name));

    // 查询指定 schema、指定表的所有外键
    // 当前表的外键字段 column_name
    // 关联的目标表 foreign_table_name
    // 目标表上被关联的字段 foreign_column_name
    const fkResult = await this.drizzle.db.execute<{
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(
      `SELECT
         kcu.column_name,
         ccu.table_name AS foreign_table_name,
         ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = '${schema}'
         AND tc.table_name = '${tableName}'`,
    );

    // 外键映射
    const fkMap = new Map(
      fkResult.rows.map((r) => [
        r.column_name,
        { table: r.foreign_table_name, column: r.foreign_column_name },
      ]),
    );

    const columns: TableColumn[] = columnsResult.rows.map((col) => ({
      name: col.column_name,
      type: this.mapPgTypeToColumnType(col.data_type),
      isNullable: col.is_nullable === 'YES',
      isPrimaryKey: pkColumns.has(col.column_name),
      defaultValue: col.column_default,
      foreignKey: fkMap.get(col.column_name) ?? null,
    }));

    if (columns.length === 0) {
      throw new NotFoundException(`Table "${tableName}" not found`);
    }

    return { name: tableName, columns };
  }

  // TODO:QUESTION
  private isMissingTableError(err: unknown): boolean {
    const code =
      err &&
      typeof err === 'object' &&
      'cause' in err &&
      err.cause &&
      typeof err.cause === 'object' &&
      'code' in err.cause
        ? String(err.cause.code)
        : null;

    return code === '42P01';
  }

  // 获取表格行
  async getTableRows(
    orgSlug: string,
    projectSlug: string,
    tableName: string,
    limit = 100,
    offset = 0,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    this.assertSafeIdentifier(tableName, 'table name');
    const schema = await this.getProjectSchema(orgSlug, projectSlug);

    try {
      const [rowsResult, countResult] = await Promise.all([
        this.drizzle.db.execute<Record<string, unknown>>(
          `SELECT * FROM "${schema}"."${tableName}" LIMIT ${limit} OFFSET ${offset}`,
        ),
        this.drizzle.db.execute<{ count: string }>(
          `SELECT COUNT(*) as count FROM "${schema}"."${tableName}"`,
        ),
      ]);

      return {
        rows: rowsResult.rows,
        count: parseInt(countResult.rows[0]?.count ?? '0', 10),
      };
    } catch (err) {
      if (this.isMissingTableError(err)) {
        throw new NotFoundException(`Table "${tableName}" not found`);
      }
      throw err;
    }
  }

  // 创建表
  // 分门别类地拼出 SQL 的各个片段,最后组装成一条 CREATE TABLE
  // 同时对所有用户输入的标识符做防注入校验、并用 schema 前缀隔离租户数据。
  async createTable(
    orgSlug: string,
    projectSlug: string,
    dto: CreateTableDto,
  ): Promise<void> {
    this.assertSafeIdentifier(dto.name, 'table name');
    const schema = await this.getProjectSchema(orgSlug, projectSlug);

    // CreateColumnDto[] 是数组可能是联合主键/复合主键
    const pkCols = dto.columns.filter((c) => c.isPrimaryKey);

    // 对列中信息进行处理
    // 逐列生成列定义 SQL 语句
    const columnDefs = dto.columns.map((col) => {
      this.assertSafeIdentifier(col.name, 'column name');

      if (col.foreignKeyTable) {
        this.assertSafeIdentifier(col.foreignKeyTable, 'foreign key table');
      }
      if (col.foreignKeyColumn) {
        this.assertSafeIdentifier(col.foreignKeyColumn, 'foreign key column');
      }

      const parts: string[] = [];
      // 拼类型
      let colDef = `"${col.name}" ${this.mapType(col.type)}`;

      // 如果是 bigint 主键，并且没有默认值
      // 让数据库自增处理
      if (col.isPrimaryKey && col.type === 'bigint' && !col.defaultValue) {
        colDef += ' GENERATED ALWAYS AS IDENTITY';
      }

      parts.push(colDef);

      if (col.isPrimaryKey && pkCols.length === 1) parts.push('PRIMARY KEY');
      if (!col.isNullable && !col.isPrimaryKey) parts.push('NOT NULL');
      if (col.defaultValue) {
        parts.push(`DEFAULT ${this.formatDefault(col.defaultValue, col.type)}`);
      }

      return parts.join(' ');
    });

    // 联合主键约束
    const pkConstraint =
      pkCols.length > 1
        ? `PRIMARY KEY (${pkCols.map((c) => `"${c.name}"`).join(', ')})`
        : null;

    // 外键约束
    const fkConstraints = dto.columns
      .filter((col) => col.foreignKeyTable && col.foreignKeyColumn)
      .map(
        (col) =>
          `FOREIGN KEY ("${col.name}") REFERENCES "${schema}"."${col.foreignKeyTable!}" ("${col.foreignKeyColumn!}")`,
      );

    // 拼接 SQL 语句
    const allDefs = [
      ...columnDefs,
      ...(pkConstraint ? [pkConstraint] : []),
      ...fkConstraints,
    ].join(', ');

    await this.drizzle.db.execute(
      `CREATE TABLE "${schema}"."${dto.name}" (${allDefs})`,
    );
  }

  // 删除表
  async deleteTable(
    orgSlug: string,
    projectSlug: string,
    tableName: string,
  ): Promise<void> {
    this.assertSafeIdentifier(tableName, 'table name');
    const schema = await this.getProjectSchema(orgSlug, projectSlug);
    await this.drizzle.db.execute(
      `DROP TABLE IF EXISTS "${schema}"."${tableName}"`,
    );
  }

  // 添加列
  async addColumn(
    orgSlug: string,
    projectSlug: string,
    tableName: string,
    dto: AddColumnDto,
  ): Promise<void> {
    this.assertSafeIdentifier(tableName, 'table name');
    this.assertSafeIdentifier(dto.name, 'column name');
    const schema = await this.getProjectSchema(orgSlug, projectSlug);

    let colDef = `"${dto.name}" ${this.mapType(dto.type)}`;
    if (dto.defaultValue) {
      colDef += ` DEFAULT ${this.formatDefault(dto.defaultValue, dto.type)}`;
    }

    await this.drizzle.db.execute(
      `ALTER TABLE "${schema}"."${tableName}" ADD COLUMN ${colDef}`,
    );
  }

  // 删除列
  async dropColumn(
    orgSlug: string,
    projectSlug: string,
    tableName: string,
    columnName: string,
  ): Promise<void> {
    this.assertSafeIdentifier(tableName, 'table name');
    this.assertSafeIdentifier(columnName, 'column name');
    const schema = await this.getProjectSchema(orgSlug, projectSlug);
    await this.drizzle.db.execute(
      `ALTER TABLE "${schema}"."${tableName}" DROP COLUMN "${columnName}"`,
    );
  }

  // 更新行
  async updateRow(
    orgSlug: string,
    projectSlug: string,
    tableName: string,
    pkColumn: string,
    pkValue: string,
    updates: Record<string, unknown>,
  ): Promise<void> {
    this.assertSafeIdentifier(tableName, 'table name');
    this.assertSafeIdentifier(pkColumn, 'primary key column');
    Object.keys(updates).forEach((col) =>
      this.assertSafeIdentifier(col, 'column name'),
    );

    const schema = await this.getProjectSchema(orgSlug, projectSlug);

    const setFragments = Object.entries(updates).map(
      ([col, val]) => sql`${sql.identifier(col)} = ${val}`,
    );

    await this.drizzle.db.execute(
      sql`UPDATE ${sql.identifier(schema)}.${sql.identifier(tableName)}
          SET ${sql.join(setFragments, sql`, `)}
          WHERE ${sql.identifier(pkColumn)} = ${pkValue}`,
    );
  }
}
