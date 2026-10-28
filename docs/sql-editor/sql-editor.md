# sql-editor

让用户在云端执行 SQL 语句，并返回执行结果

每个 project 一个 role，REVOKE ALL ON SCHEMA x FROM PUBLIC，只 GRANT 自己的。​唯一真正可靠的，因为它在数据库内核层面拦截

## Features

- 怎么做的数据隔离
- 怎么防止a用户查到b用户的数据

## 怎么做的数据隔离

隔离分三层，**只有第一层是真正的边界**，另外两层只是便利与纵深。

| 层 | 手段 | 性质 |
| --- | --- | --- |
| ① 身份 | 事务内 `SET LOCAL ROLE proj_<hex>_usr` | 数据库内核强制，越界直接报错 |
| ② 命名空间 | `SET LOCAL search_path TO "proj_<hex>"` | 仅决定未限定表名的解析顺序，便于省略 schema 前缀 |
| ③ 对象授权 | `GRANT` 表/序列给项目角色 | 细粒度补充，由 schema 的 `USAGE` 统一兜住 |

### ① 项目角色（唯一可靠的一层）

每个 project 在创建时（`ProjectsService.createProject` → `provisionProjectRole`）获得一个独立的 NOLOGIN 角色，命名由 `dbSchema` 确定性派生：`proj_9f3a1c02` → `proj_9f3a1c02_usr`。

```sql
CREATE SCHEMA IF NOT EXISTS "proj_9f3a1c02";              -- 所有者是 provisioner，不是项目角色
CREATE ROLE "proj_9f3a1c02_usr" NOLOGIN;
GRANT USAGE, CREATE ON SCHEMA "proj_9f3a1c02" TO "proj_9f3a1c02_usr";
GRANT ALL ON ALL TABLES IN SCHEMA "proj_9f3a1c02" TO "proj_9f3a1c02_usr";
GRANT ALL ON ALL SEQUENCES IN SCHEMA "proj_9f3a1c02" TO "proj_9f3a1c02_usr";
ALTER DEFAULT PRIVILEGES IN SCHEMA "proj_9f3a1c02" GRANT ALL ON TABLES TO "proj_9f3a1c02_usr";
ALTER DEFAULT PRIVILEGES IN SCHEMA "proj_9f3a1c02" GRANT ALL ON SEQUENCES TO "proj_9f3a1c02_usr";
GRANT "proj_9f3a1c02_usr" TO CURRENT_USER;                -- 让 API 连接身份能 SET ROLE 进来
```

两个关键设计：

- **schema 的所有者是 provisioner，不是项目角色。** 如果让项目角色拥有自己的 schema，它就能 `GRANT USAGE ON SCHEMA ... TO PUBLIC`，隔离当场失效。现在项目角色只有 `USAGE`/`CREATE`，无法把 schema 使用权转授给任何人。
- **`ALTER DEFAULT PRIVILEGES`** 让之后由 provisioner 新建的对象自动授权给项目角色。表编辑器是以 owner 身份建表的，没有这条规则，项目角色会看不到这些表。

用户 SQL 在一个事务里以项目角色身份执行：

```ts
neonSql.transaction(
  (txn) => [
    txn`SET LOCAL ROLE ${txn.unsafe(quoteIdentifier(projectRole))}`,
    txn`SET LOCAL search_path TO ${txn.unsafe(quoteIdentifier(project.dbSchema))}`,
    txn`${txn.unsafe(statement)}`,
  ],
  { fullResults: true, readOnly: false },
);
```

`SET LOCAL ROLE` **必须是第一条**：它失败会中止整批事务，用户 SQL 不会退回 owner 身份执行（fail-closed）。降到项目角色之后也无法再 `SET ROLE` 到别的项目——`SET ROLE` 的权限按当前角色的成员关系判定，项目角色之间互不隶属。

### ② 收紧 public schema

migration `0003_project_role_isolation.sql` 一次性收回 `public` 对 `PUBLIC` 的默认权限：

```sql
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
```

PostgreSQL 15 起 `public` schema 的 `CREATE` 已从 `PUBLIC` 收回，但 **`USAGE` 仍然默认授予 `PUBLIC`**，必须显式 `REVOKE`。

完成后平台控制面表（`users`、`projects`、`query_history`、`storage_*`）对任何项目角色都不可见，而 owner 身份不受影响。

### ③ search_path 只放项目 schema

```ts
txn`SET LOCAL search_path TO ${txn.unsafe(quoteIdentifier(project.dbSchema))}`;
```

`search_path` 是**名字解析顺序**，不是访问控制。它解决的是"用户能不能省略 schema 前缀"，不解决"用户能不能访问"。曾经写成 `"proj_x", public`，导致项目 schema 里没有这张表时会**静默继续往后找**并命中 `public` 里的同名对象，返回 200 和别人的数据。现在 `public` 已从 `search_path` 移除，且即使被加回来也没有 `USAGE`。

## 怎么防止 a 用户查到 b 用户的数据

逐条封堵常见的越界路径：

| 越界方式 | 拦截点 |
| --- | --- |
| `SELECT * FROM users`（未限定名，A 的 schema 里没有） | `search_path` 只含 A 的 schema，`public` 的 `USAGE` 已收回 → `42P01` 或 `permission denied for schema public` |
| `SELECT * FROM public.users`（全限定名） | 项目角色对 `public` 无 `USAGE` → `permission denied for schema public` |
| `SELECT * FROM proj_b7c2.orders`（跨项目全限定名） | 项目角色对 `proj_b7c2` 无 `USAGE` → `permission denied for schema proj_b7c2` |
| `SET ROLE proj_b7c2_usr`（提权） | A 的角色不是 B 的成员 → `permission denied to set role` |
| `CREATE TABLE public.x` | 对 `public` 无 `CREATE` → `permission denied for schema public` |
| `DROP TABLE proj_b7c2.orders` | 对目标 schema 无 `USAGE` → `permission denied` |
| 拿到 `projects.db_schema` 后按名字猜 | 知道 schema 名也没用：访问由 `USAGE` 决定，不由名字决定 |

验收 SQL（在隔离环境执行，期望值写在注释里）：

```sql
SELECT current_user;              -- proj_<hex>_usr，不是 owner
SELECT * FROM public.users;       -- permission denied for schema public
SELECT * FROM proj_b7c2.orders;   -- permission denied for schema proj_b7c2
CREATE SCHEMA hack;               -- permission denied for database
SET ROLE proj_b7c2_usr;           -- permission denied（不是成员）
SELECT * FROM orders;             -- 成功：落到自己 schema 的 orders
```

### 残余风险

- `pg_class`/`pg_namespace` 对所有角色可读，**其他项目的 schema 名和表名可见**（只有元数据，没有数据）。
- 项目 schema 里不能出现 `SECURITY DEFINER` 函数，否则执行者会以函数所有者身份运行。realtime 的 trigger 函数当前是 invoker，安全——这条需要作为约束保持。
- 若将来从 neon-http 换成 session 连接池，归还连接前必须 `DISCARD ALL`，否则 `SET ROLE` 可能污染下一个请求。

## 上线步骤

1. `pnpm --filter api db:migrate` —— 应用 `0003_project_role_isolation`（收回 `public` 权限）。
2. `pnpm --filter api db:backfill-project-roles` —— 为存量项目补齐角色与授权（幂等）。
3. 新建项目会自动 provisioning，无需额外操作。

前置条件（务必先核对，否则第 1 步可能让整个 API 失去控制面访问）：

```sql
SELECT current_user, pg_has_role(current_user, 'pg_database_owner', 'MEMBER') AS is_db_owner,
       rolcreaterole FROM pg_roles WHERE rolname = current_user;
```

- `is_db_owner = true`（或该角色对 `public` 有显式 `USAGE`）：执行 `REVOKE ... FROM PUBLIC` 后控制面仍可访问。
- `rolcreaterole = true`：建项目时才能 `CREATE ROLE`。缺少该权限时建项目会直接失败，不做降级。

## 尚未覆盖

本次只实现了隔离层。以下问题仍待处理，详见 `fixes/sql-editor/`：

- SE-003 任意写：`readOnly: false` 未改，用户仍可 `DELETE`/`DROP TABLE` 自己 schema 内的对象。
- SE-004 授权粒度：任意组织成员（含 `developer`）仍可打开 SQL Editor。
- SE-005 资源预算：无 `statement_timeout`、无结果行数上限。
- SE-007/008/010：单语句解析、错误分类、结果规范化。
