/**
 * 重置 Neon 数据库的 public schema，便于从头重跑迁移。
 *
 * 背景：drizzle-kit generate 生成的迁移文件不带 IF NOT EXISTS，
 * 一旦迁移执行到一半失败（例如新增 NOT NULL 列时表里已有数据），
 * 已成功的部分不会回滚，重跑就会因 “already exists” 反复失败。
 *
 * 用法：
 *   pnpm db:reset -- --yes   确认后执行（会清空 public schema 下所有数据）
 *   pnpm db:reset           仅打印将要执行的操作，不实际执行
 */
import 'dotenv/config';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('缺少 DATABASE_URL，请检查 apps/api/.env');
  process.exit(1);
}

const confirmed = process.argv.includes('--yes');
const target = DATABASE_URL.replace(/:\/\/[^@]+@/, '://***@');

console.log(`目标数据库: ${target}`);

if (!confirmed) {
  console.log('未指定 --yes，仅预览。将执行：DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('确认无误后运行: pnpm db:reset -- --yes');
  process.exit(0);
}

const client = new Client({ connectionString: DATABASE_URL });

async function main() {
  await client.connect();
  console.log('已连接，正在重置 public schema ...');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE;');
  await client.query('CREATE SCHEMA public;');
  // drizzle 的迁移记录表在 public 之外的 schema 里，需要一并清理，
  // 否则 drizzle-kit migrate 会以为迁移已执行过而直接跳过。
  await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
  console.log('重置完成，现在可以运行: pnpm db:migrate');
}

main()
  .catch((err) => {
    console.error('重置失败:', err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
