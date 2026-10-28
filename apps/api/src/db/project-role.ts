import { sql } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type * as schema from './schema/index.js';

/**
 * 项目数据库角色名。由 `projects.dbSchema` 确定性派生，不额外存字段，
 * 因此不需要为存量项目回填列，也不会出现 schema 与 role 不一致的状态。
 *
 * 例：`proj_9f3a1c02` -> `proj_9f3a1c02_usr`（17 bytes，远低于 PG 63 bytes 限制）。
 */
export function projectRoleName(dbSchema: string): string {
  return `${dbSchema}_usr`;
}

/**
 * 把标识符包装成 PostgreSQL 双引号形式。标识符不能用参数绑定，
 * 只能靠正确 quoting；内嵌的双引号按 SQL 规则翻倍。
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * 为一个项目创建数据库角色并只授予它自己 schema 的权限。
 *
 * 这是 SQL Editor 数据隔离的第一层，也是唯一由数据库内核强制的边界：
 * - schema 归 provisioner（当前连接角色）所有，项目角色只有 USAGE/CREATE，
 *   因此项目角色无法把 schema 使用权再转授给第三方；
 * - 项目角色拿到自己 schema 内表的全量权限，但没有任何其他 schema 的权限；
 * - `REVOKE ALL ON SCHEMA public FROM PUBLIC` 由 migration 一次性完成，
 *   控制面表因此对项目角色不可见。
 *
 * 该函数幂等，可在建项目时调用，也可由 `scripts/backfill-project-roles.ts` 对存量项目重跑。
 * 缺少 CREATEROLE 权限时会直接抛错，不做降级。
 */
export async function provisionProjectRole(
  db: NeonHttpDatabase<typeof schema>,
  dbSchema: string,
): Promise<void> {
  const role = projectRoleName(dbSchema);
  const schemaIdent = sql.identifier(dbSchema);
  const roleIdent = sql.identifier(role);

  // schema 的所有者保持为 provisioner，不交给项目角色
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${schemaIdent}`);

  const roleExists = await db.execute<{ exists: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS "exists"`,
  );
  if (!roleExists.rows[0]?.exists) {
    await db.execute(sql`CREATE ROLE ${roleIdent} NOLOGIN`);
  }

  await db.execute(
    sql`GRANT USAGE, CREATE ON SCHEMA ${schemaIdent} TO ${roleIdent}`,
  );

  // 存量对象：表编辑器和历史迁移是以 provisioner 身份建表的
  await db.execute(
    sql`GRANT ALL ON ALL TABLES IN SCHEMA ${schemaIdent} TO ${roleIdent}`,
  );
  await db.execute(
    sql`GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schemaIdent} TO ${roleIdent}`,
  );

  // 之后由 provisioner 新建的对象自动授权，避免每建一张表都要补 GRANT
  await db.execute(
    sql`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} GRANT ALL ON TABLES TO ${roleIdent}`,
  );
  await db.execute(
    sql`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} GRANT ALL ON SEQUENCES TO ${roleIdent}`,
  );

  // 让 API 连接身份可以 SET LOCAL ROLE 进入项目角色
  await db.execute(sql`GRANT ${roleIdent} TO CURRENT_USER`);
}
