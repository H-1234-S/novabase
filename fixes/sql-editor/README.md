# SQL Editor 深度审查摘要

## 修复实施状态

当前为**审查基线**，代码尚未修改。下表状态均指 `apps/api/src/sql-editor/` 与 `apps/web/src/features/sql-editor/` 的现状。

| 编号 | 当前状态 | 摘要 |
|---|---|---|
| SE-001 | 未修复 | `search_path` 末尾带 `public`，项目 schema 缺表时静默读到平台控制面/其他租户数据，HTTP 200 返回。 |
| SE-002 | 未修复 | 全库单一 DB 角色，schema 只是命名空间；`SELECT db_schema FROM projects` 后可用全限定名直读任意项目。 |
| SE-003 | 未修复 | 危险语句黑名单 3 条前缀匹配可绕过；`readOnly: false` 主动关闭了驱动自带的事务只读护栏。 |
| SE-004 | 未修复 | 任意组织成员（含 viewer）可执行任意 SQL；`query_history` 无 `userId`，无法追责。 |
| SE-005 | 未修复 | 无 `statement_timeout`、无结果集上限、无取消通道；`SELECT * FROM 大表` 全量进 Node 内存。 |
| SE-006 | 未修复 | `SET LOCAL` 是静默失败型护栏，租户隔离依赖 Neon batch 的隐式事务语义这一隐式契约。 |
| SE-007 | 未修复 | `split(';')` 判断单语句，含分号的字符串/美元引用/注释被误判为多语句。 |
| SE-008 | 未修复 | 所有异常压成 400，PG 原始 `message`/`hint`/`column` 直接回传前端。 |
| SE-009 | 未修复 | 历史写入在业务事务之外且被同一个 `catch` 覆盖，已提交的写操作会被报为失败。 |
| SE-010 | 未修复 | `columns` 从 `rows[0]` 推导，空结果集无列名、重名列静默丢列；结果按数组位置取。 |
| SE-011 | 未修复 | 前端默认查询是 `SELECT * FROM users LIMIT 10;`（未限定名，直接命中 `public.users`）；历史乐观更新伪造 `projectId`。 |

## 审查范围

基于当前工作区源码审查：

- `apps/api/src/sql-editor/{sql-editor.controller.ts,sql-editor.service.ts,dto/execute-query.dto.ts}`
- `apps/api/src/auth/guards/{jwt-auth.guard.ts,org-role.guard.ts}`、`apps/api/src/main.ts`（全局前缀/ValidationPipe/CORS）
- `apps/api/src/projects/projects.service.ts`（schema 创建与项目密钥签发）、`apps/api/src/db/{drizzle.service.ts,schema/*}`
- `apps/api/src/table-editor/table-editor.service.ts`（作为 schema 绑定的对照实现）
- `apps/web/src/features/sql-editor/{sql-editor-client.tsx,sql-editor-helpers.server.ts}`
- `@neondatabase/serverless@1.1.0` 本地安装代码（`node_modules/.pnpm/@neondatabase+serverless@1.1.0`）
- PostgreSQL 官方文档：标识符与 schema 搜索路径、`SET LOCAL`、`set_config`、只读事务

审查只读源码/依赖/文档，**未连接真实 Neon 或 PostgreSQL 执行任何 SQL**。所有"最小复现"必须在隔离环境验证，不得在生产库执行。

## 问题状态与统计

共 **11 项**：P0 3 项、P1 2 项、P2 5 项、P3 1 项。

| 编号 | 优先级 | 置信度 | 摘要 |
|---|---:|:--:|---|
| SE-001 | P0 | 已确认 | `search_path` 含 `public`；缺表不报错而是继续命中 `public`；`public` 里是控制面表。 |
| SE-002 | P0 | 已确认 | 无 GRANT/RLS/ROLE；`db_schema` 与项目密钥都在 `public.projects`，一条 SELECT 即可全库扩散。 |
| SE-003 | P0 | 已确认 | 黑名单注释/双空格绕过；`DELETE`/`ALTER`/`DROP TABLE` 全放行；`readOnly: false`。 |
| SE-004 | P1 | 已确认 | 控制器无 `@RequireOrgRole`；审计表无操作主体。 |
| SE-005 | P1 | 已确认 | 无超时/无行数上限/无取消；DTO 无 `MaxLength`（仅被 Express 100kb 默认上限兜住）。 |
| SE-006 | P2 | 已确认 | `SET LOCAL` 脱离事务块只产生 WARNING；隔离依赖未声明的隐式契约。 |
| SE-007 | P2 | 已确认 | `SELECT 'a;b'`、`$$ ... ; ... $$`、注释内分号均被拒。 |
| SE-008 | P2 | 已确认 | 基础设施故障返回 400；错误信息可探测其他租户 schema 结构。 |
| SE-009 | P2 | 已确认 | 与 `fixes/database/issues.md` DB-002 同源；重试导致重复写入。 |
| SE-010 | P2 | 已确认 | 空结果集无列名；`SELECT 1 AS a, 2 AS a` 丢列；`results[len-1]` 位置脆弱。 |
| SE-011 | P3 | 已确认 | 默认查询直接指向 `public.users`；历史条目本地伪造。 |

## 已排除/没有证据定为缺陷的点

- **多语句注入当前不可行**：`parseSingleStatement()` 拒绝含 `;` 的输入，且 Neon batch 对数组中每个 query 单独走扩展协议。但这不是安全保证——攻击面是"**单条**任意语句"，已足够造成 SE-002/SE-003 描述的全部后果。不要把"防住了多语句"当成"防住了破坏"。
- **`transaction()` 的事务语义本身正确**：驱动把查询数组打成 `{queries:[...]}` 单次 POST，服务端在同一隐式事务内顺序执行，第二条失败整体回滚。`SET LOCAL` 因此生效。问题不在事务，在 `search_path` 的内容。
- **`getProject()` 未校验调用者成员关系**：由 `OrgRoleGuard` 在 controller 层完成，不算缺陷；但它只校验"组织成员"，见 SE-004。
- **表编辑器的 schema 绑定是正确的**：`table-editor.service.ts` 每条 SQL 都硬拼 `"${schema}"."${table}"` 并校验标识符，是本仓库唯一做对 schema 绑定的模块，可作为 SQL Editor 的对照实现。
- **`assertSafeIdentifier` 正则本身够用**：`^[a-zA-Z_][a-zA-Z0-9_]*$` 配合双引号引用不会产生标识符注入。问题在于它是唯一防线，没有纵深（见 SE-006）。

## 推荐修复顺序及依赖

1. **先止血（同批上线）**：SE-003 恢复只读事务 + SE-001 去掉 `search_path` 里的 `public`。两项都在同一处代码，改动小、见效快，但只能挡住"误读/误写"。
2. **再建边界**：SE-002 项目角色隔离。这是唯一能挡住"故意越界"的手段，也是 SE-001/SE-003 的最终兜底。前置动作是盘点 `public` 内对象并迁移控制面。
3. **收紧入口**：SE-004 管理员限定 + 审计主体；SE-005 时间与体量预算。SQL Editor 是全库写入口，这两项决定"谁能触发"和"能造成多大影响"。
4. **修正确性**：SE-006 显式断言事务契约 → SE-007 引入解析器（同时替换 SE-003 的黑名单）→ SE-008 错误分类 → SE-009 审计事务边界 → SE-010 结果规范化。
5. **收尾体验**：SE-011 前端默认值与历史一致性。

每个问题的实现思路、替代方案、回归风险与验收见 `recommendations.md`。

## 尚未验证与所需环境

- **Neon batch 隐式事务语义**：本地只读到驱动代码，未在真实 Neon 验证 `SET LOCAL` / `set_config(..., true)` 是否确实在同一事务内生效，以及第二条语句失败时是否整体回滚。这是 SE-001/SE-006 的前提。
- **`DATABASE_URL` 的实际权限**：代码只能证明 SQL Editor 复用同一连接身份，不能证明该角色是否 owner、是否有跨 schema 权限、是否配置了默认 `statement_timeout`。需在隔离环境执行 `SELECT current_user, current_setting('statement_timeout')` 与 `\dn+` 核对。
- **生产 `public` schema 的实际内容**：是否存在历史遗留的业务表、扩展对象（`uuid-ossp`/`citext` 等）。这决定 SE-001 修复后的回归面，需要只读盘点。
- **Neon 池化连接的 session reset 行为**：用户执行 `SET search_path TO public`（非 `LOCAL`）是否会污染复用的池化连接、进而影响其他请求，取决于 Neon 是否在归还连接时 reset。未确认为缺陷，但需要验证。
- **部署形态**：是否启用 Neon 连接池（PgBouncer）、API 实例数量。多实例下 `statement_timeout` 与连接预算需按实例数校准。
- **产品语义**：SQL Editor 是否只对 `admin`/`owner` 开放、查询历史是"个人"还是"项目共享"。SE-004/SE-011 的最终形态取决于此。

## 交叉引用

- `fixes/database/issues.md` DB-002（历史写入失败误报失败）与本目录 SE-009 为同一问题，SE-009 补充了审计主体与授权视角。
- `fixes/database/issues.md` DB-001（SQL 黑名单可绕过）与本目录 SE-003 同源，SE-003 增加了 `readOnly` 护栏与解析器替代方案。
- `fixes/realtime/` RT-001 与 SE-002 是同一类根因（把字符串/命名空间当成安全边界），修复可复用同一套数据库角色方案。
