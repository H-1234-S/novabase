import 'dotenv/config';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../src/db/schema/index.js';
import { projectRoleName, provisionProjectRole } from '../src/db/project-role.js';

// 为存量项目补齐数据库角色与 schema 授权。
// 幂等：可重复执行；缺少 CREATEROLE 权限时会直接失败，不做降级。
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to provision project roles');
}

const db = drizzle(databaseUrl, { schema });

const rows = await db
  .select({ slug: schema.projects.slug, dbSchema: schema.projects.dbSchema })
  .from(schema.projects);

for (const row of rows) {
  await provisionProjectRole(db, row.dbSchema);
  console.log(`provisioned ${row.slug}: ${row.dbSchema} -> ${projectRoleName(row.dbSchema)}`);
}

console.log(`done: ${rows.length} project(s)`);
