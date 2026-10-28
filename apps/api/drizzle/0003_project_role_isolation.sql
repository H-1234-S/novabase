-- 数据隔离第一层：收回 public schema 对 PUBLIC 的默认权限。
-- PostgreSQL 15 起 public schema 归 pg_database_owner 所有并收回了 CREATE，
-- 但 USAGE 仍然默认授予 PUBLIC，因此必须显式 REVOKE。
--
-- 效果：项目角色（proj_<hex>_usr）只被 GRANT 自己的 schema，对 public 没有任何权限，
-- 平台控制面表（users/projects/query_history/storage_*）对任何项目角色都不可见。
-- 即使 SQL Editor 的 search_path 失效或被绕过，越界访问也会被数据库内核拒绝。
-- 所有者（DATABASE_URL 对应的连接身份）不受影响，控制面代码可继续访问。
REVOKE ALL ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
