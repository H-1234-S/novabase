# SQL Editor 深度审查问题

> 本文记录源码审查确认的问题基线。修复优先级针对当前"单一 `DATABASE_URL` 数据库角色 + 项目 schema 隔离"的实现。
> 如果未来为 SQL Editor 配置了受限数据库角色，SE-002/SE-003 的影响面会相应收窄，但 SE-001 的跨租户读取路径仍然成立。

## 背景：search_path 语义（原审查笔记）

当写了一个没有 schema 前缀的表名时，PG 按照 `search_path` 去找表；当写了一个带有 schema 前缀的表名时，PG 不会看 `search_path`。

这两条规则叠加后还有第三个事实：**按 `search_path` 找表时，前一个 schema 里没有该表不会报错，而是继续往后找**。所以 `search_path = "proj_a", public` 的真实含义不是"A 的 schema，找不到就报错"，而是"A 的 schema，找不到就用 public 的"。SE-001 的全部结论都建立在这条语义上。

---

## [SE-001] `search_path` 末尾包含 `public`，项目内缺失的表会静默读到平台控制面或其他租户数据

- **优先级**：P0
- **置信度**：已确认（源码 + PostgreSQL 名字解析规则；实际读到的内容取决于 `public` 里现有对象）
- **问题类型**：跨租户数据泄露 / 数据隔离
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts:123-131`、`apps/api/src/projects/projects.service.ts:44-48`、`apps/api/src/db/schema/*.ts`、`apps/web/src/features/sql-editor/sql-editor-client.tsx:51`
- **调用链**：`POST /api/orgs/:slug/projects/:projectSlug/sql` → `JwtAuthGuard` → `OrgRoleGuard`（仅校验组织成员）→ `SqlEditorController.executeQuery()` → `SqlEditorService.getProject()` 取 `projects.dbSchema` → `neonSql.transaction([SET LOCAL search_path TO "<schema>", public, <用户语句>])`。
- **触发条件与最小复现**：项目 A 的 schema 中不存在 `users` 表时，提交 `SELECT email, password_hash FROM users LIMIT 5;`。期望是 `42P01 relation "users" does not exist`，实际返回 `public.users` 的行。前端默认编辑器内容本身就是 `SELECT * FROM users LIMIT 10;`（`sql-editor-client.tsx:51`），打开页面直接点 Run 即可复现，无需构造。**请在隔离测试环境验证，不要在生产库执行。**
- **问题描述**：`SET LOCAL search_path TO ${txn.unsafe(`"${project.dbSchema}", public`)}` 把 `public` 放在了兜底位置。PostgreSQL 解析未限定标识符时按 `search_path` 顺序逐个 schema 查找，**前序 schema 未命中不报错**，命中 `public` 即返回。于是"项目 schema 里没有这张表"不会导致失败，只会导致返回 `public` 里同名对象的数据，且 HTTP 状态是 200。
- **根因分析**：用 `search_path` 承担了租户隔离职责，但 `search_path` 是**名字解析顺序**，不是**访问控制**。同时仓库里 `public` 恰好是平台控制面的所在 schema：Drizzle 的 `pgTable('users', ...)` 未指定 schema，默认全部落在 `public`，包括 `users`（含 `password_hash`）、`organizations`、`projects`（含 `db_schema`、`anon_key`、`service_role_key`）、`org_members`、`query_history`、`storage_buckets`、`storage_objects`。
- **已确认事实**：
  - `projects.service.ts:47` 的 `CREATE SCHEMA IF NOT EXISTS "<dbSchema>"` 与所有控制面表在同一个数据库实例内，schema 隔离而非实例隔离。
  - `public` 是所有租户共享的**可写**命名空间：SQL Editor 允许 `CREATE TABLE public.orders (...)`，任何一次未加 schema 前缀的迁移/脚本/人工操作也会把对象落进 `public`。此后所有项目查询未限定名的 `orders` 都会命中它。
  - 表编辑器不受影响：`table-editor.service.ts` 每条 SQL 都硬拼 `"${schema}"."${table}"`，是当前仓库里唯一做对了 schema 绑定的模块。
- **影响范围**：A 项目能读到 B 项目的同名表、平台全站用户表（邮箱 + 密码 hash）、全站项目表（含项目密钥）。因为返回 200 且数据结构正常，调用方与用户都不会察觉，属于最难发现的一类缺陷。
- **修复建议**：`search_path` 只保留项目 schema 本身；把控制面表迁出 `public` 到独立 schema 并收回授权；长期由数据库角色而非 `search_path` 承担隔离（见 SE-002）。**仅去掉 `public` 只能止血，不能根治**——用户仍可写 `SELECT * FROM public.users` 或 `SELECT * FROM proj_other.orders`。
- **依赖/关联**：SE-002（schema 不是权限边界）；SE-011（前端默认查询直接命中 `public.users`）。
- **验证方式**：在隔离库确认 `SHOW search_path` 与预期一致；断言项目 schema 缺表时返回 `42P01` 而非他人数据；用两个项目的同名表做正反向测试；`SELECT * FROM public.users` 应被数据库拒绝而不是返回行。

## [SE-002] 全站共用一个数据库角色，schema 隔离只是命名空间，全限定名可直读任意项目

- **优先级**：P0
- **置信度**：已确认（源码 grep 无任何 `GRANT`/`REVOKE`/`ROW LEVEL SECURITY`/`SET ROLE`）
- **问题类型**：越权访问 / 租户隔离失效
- **涉及文件**：`apps/api/src/db/drizzle.service.ts`、`apps/api/src/sql-editor/sql-editor.service.ts:44-58,123-131`、`apps/api/src/projects/projects.service.ts:44-48`
- **调用链**：`getNeonClient()` 直接取 `drizzle.db.$client`，即 `DATABASE_URL` 对应的同一个连接身份；该身份同时用于控制面查询、建 schema、表编辑器和 SQL Editor。
- **触发条件与最小复现**：任一组织成员依次执行三条语句（单条提交，各自独立请求）：
  1. `SELECT db_schema FROM projects;` —— 拿到全部租户 schema 名；
  2. `SELECT * FROM proj_9f3a.orders;` —— 全限定名绕过 `search_path`，直读任意项目；
  3. `SELECT service_role_key FROM projects;` —— 拿到 `expiresIn: '100y'` 的项目密钥，可绕过 `project-api` 的全部组织隔离。

  **请只在隔离环境用测试数据验证，不要在生产库执行。**
- **问题描述**：`proj_` + 8 位 hex 的 schema 名看似不可猜，但 `public.projects.db_schema` 把它们全部列了出来，所以"不可猜"不构成任何保护。全限定名不经过 `search_path`，因此 SE-001 的修复对这条路径完全无效。
- **根因分析**：把"每个项目一个 schema"当成了隔离机制，但没有配套的数据库角色。`provisionschema()` 只 `CREATE SCHEMA`，不创建 role、不 `GRANT`、不 `REVOKE`，项目之间、项目与控制面之间在数据库权限层面完全等价。仓库内不存在 RLS 策略，因此也没有行级兜底。
- **已确认事实**：`grep -rn "GRANT|REVOKE|ROW LEVEL SECURITY|SET ROLE" apps/api/src` 无匹配；`projects.service.ts` 的 `signProjectKey` 签发 100 年不过期的 JWT，且密钥明文存于 `public.projects`。
- **影响范围**：任意组织成员 = 全库读写权限。可读取/篡改/删除所有租户数据、平台账号、项目密钥；可 `DROP TABLE` 任意表；可 `CREATE FUNCTION` 在库内留后门。
- **修复建议**：为每个项目创建独立数据库角色，`REVOKE ALL ON SCHEMA public FROM PUBLIC`，只 `GRANT USAGE ON SCHEMA proj_x` 与所需表权限，执行用户 SQL 前 `SET LOCAL ROLE proj_x_role`；控制面表迁出 `public` 且不授权给项目角色；终态可考虑项目独立 database（Neon 支持多库），物理上不共享。
- **依赖/关联**：SE-001（同一根因的两个表现）；SE-003（有权限就能写）。
- **验证方式**：用项目角色执行 `SELECT * FROM proj_other.t`、`SELECT * FROM public.users`、`CREATE SCHEMA`、`DROP TABLE`，断言全部被数据库拒绝；`current_user` 在事务内应为项目角色而非 owner。

## [SE-003] 只读事务被显式关闭，危险语句黑名单可被注释/空格/同义语句绕过

- **优先级**：P0
- **置信度**：已确认（黑名单绕过路径确定；实际破坏范围取决于 DB 角色权限，见 SE-002）
- **问题类型**：数据完整性 / 安全控制失效
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts:104-110,123-131`
- **调用链**：`executeQuery()` → `parseSingleStatement()` → `normalised.startsWith(b)` 前缀检查 → `txn.unsafe(statement)` → `neonSql.transaction(..., { readOnly: false })`。
- **触发条件与最小复现**：
  - 注释绕过：`/*x*/DROP SCHEMA proj_9f3a CASCADE`（`normalised` 以 `/*X*/` 开头，不匹配 `DROP SCHEMA`）；
  - 双空格绕过：`DROP  DATABASE xxx`（`startsWith('DROP DATABASE')` 为 false）；
  - 黑名单未覆盖：`DELETE FROM users`、`UPDATE projects SET service_role_key = '...'`、`ALTER TABLE proj_b.orders ADD COLUMN x text`、`DROP TABLE proj_b.orders`、`CREATE TABLE public.orders (...)` 全部放行。

  **请只在隔离环境验证，不要对生产库执行。**
- **问题描述**：黑名单只有 `DROP DATABASE`、`DROP SCHEMA`、`TRUNCATE` 三条，且用 `startsWith` 做字符串前缀匹配。`TRUNCATE` 被拦但等价的 `DELETE FROM` 不拦，属于自欺式防护。同时 `readOnly: false` 显式关掉了 Neon batch 端点上唯一一个不依赖字符串判断的护栏。
- **根因分析**：用文本前缀近似"语句类型判断"，而 SQL 是允许注释、任意空白、大小写、`WITH ... DELETE`、`DO $$ ... $$` 的语言，前缀匹配无法覆盖语法空间。真正的写入控制应该由数据库事务属性或角色权限承担。
- **已确认事实**：`@neondatabase/serverless@1.1.0` 的 `transaction()` 会把 `readOnly` 转成 HTTP 头 `Neon-Batch-Read-Only`（源码：`readOnly !== void 0 && (fe["Neon-Batch-Read-Only"] = String(readOnly))`）。当前传 `false`，即显式声明"这个事务可写"。改传 `true` 后服务端会把事务置为 READ ONLY，任何写操作在数据库层失败——这是现成的、零成本的第一道护栏，被主动放弃了。
- **运行时条件/影响边界**：多语句注入当前不可行——`parseSingleStatement()` 拒绝含 `;` 的输入，且 Neon batch 对每个 query 单独走扩展协议。因此攻击面是"**单条**任意语句"，但这已足够造成 SE-002 描述的全部后果。不要把"防住了多语句"误认为"防住了破坏"。
- **影响范围**：任何组织成员可对任意表执行 `DELETE`/`UPDATE`/`ALTER`/`DROP TABLE`，包括控制面表；`CREATE FUNCTION` 可留持久后门。
- **修复建议**：SELECT/WITH/EXPLAIN 类语句一律 `readOnly: true`；写语句走独立开关并限定角色；用词法/语法解析（`libpg-query` 或等价）做语句类型与对象范围判定，而不是前缀匹配；最终仍以数据库角色权限为准。
- **依赖/关联**：SE-002（权限边界缺失会放大影响）；SE-007（单语句解析本身的缺陷）。
- **验证方式**：对注释、双空格、大小写、`WITH ... DELETE`、`DO $$ ... $$` 变体做策略测试；断言只读事务下 `INSERT`/`UPDATE`/`DDL` 返回只读错误；断言非管理员角色无法执行 DDL。

## [SE-004] 任意组织成员（含只读角色）可执行任意 SQL，审计记录不区分操作人

- **优先级**：P1
- **置信度**：已确认
- **问题类型**：授权 / 审计
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.controller.ts:7-19`、`apps/api/src/auth/guards/org-role.guard.ts:28-62`、`apps/api/src/db/schema/query-history.ts:4-13`、`apps/api/src/sql-editor/sql-editor.service.ts:139-144,160-169`
- **调用链**：`@UseGuards(JwtAuthGuard, OrgRoleGuard)` 无 `@RequireOrgRole` 装饰器 → `OrgRoleGuard` 中 `requiredRole` 为 `undefined` → 只校验"是否该组织未移除成员" → 直接放行。
- **触发条件与最小复现**：用组织内 `developer`（`OrgRole` 中的非管理员角色）账号登录，打开项目 SQL Editor 执行 `DROP TABLE proj_x.some_table`。当前无任何拦截。
- **问题描述**：SQL Editor 是全库级别的写入口，但授权粒度等同于"组织成员"。`OrgRole` 只有 `'admin' | 'developer'` 两个取值，`OrgRoleGuard` 支持 `@RequireOrgRole('admin')`（`members`、`projects` 控制器已在用），本控制器没有使用。`queryHistory` 表只有 `projectId`、`sql`、`executionTimeMs`、`rowCount`、`createdAt`，**没有 `userId`/`orgId`**，因此发生破坏性操作时无法定位是谁执行的。
- **根因分析**：把"能进项目页"当成"能执行任意 SQL"。审计表按项目维度设计，缺少操作主体字段，导致即使想追责也没有数据。
- **影响范围**：内部越权与误操作不可追溯；一个低权限成员即可清空/篡改整个组织数据。`getHistory()` 返回项目内所有成员的查询历史（含可能含敏感字面量的 SQL），成员之间互相可见。
- **修复建议**：SQL Editor 限定为 `admin`（加 `@RequireOrgRole('admin')`，与 `members`/`projects` 控制器保持一致；若希望 `developer` 仍能跑只读查询，则按 SE-003 的语句分类做差异化放行）；`queryHistory` 增加 `userId`、`orgId`、`command`、`errorCode` 字段，并记录受影响行数与目标对象；历史查询按 `userId` 过滤或明确产品语义为"项目共享"。
- **依赖/关联**：SE-002/SE-003 的影响面由本项决定"谁能触发"；SE-009（审计写入的可靠性）。
- **验证方式**：`viewer` 调用应 403；`admin` 可执行并留下带 `userId` 的记录；历史接口不返回他人记录（或按产品决策显式共享）。

## [SE-005] 无语句超时、无结果集上限、无取消通道，单次查询可拖垮实例

- **优先级**：P1
- **置信度**：已确认（无相关代码；Neon 侧默认行为待验证）
- **问题类型**：资源耗尽 / 可用性
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts:93-157`、`apps/api/src/sql-editor/dto/execute-query.dto.ts:1-7`、`apps/web/src/features/sql-editor/sql-editor-client.tsx:59-107`
- **触发条件与最小复现**：执行 `SELECT pg_sleep(600);` 或对两张百万行表做无条件笛卡尔积，再执行 `SELECT * FROM big_table;` 观察响应体大小与 Node 内存。
- **问题描述**：事务里没有 `SET LOCAL statement_timeout`；`fullResults: true` 会把整个结果集读进 Node 内存后一次性 JSON 序列化返回，没有行数上限；前端 `fetch` 没有 `AbortController`，用户无法停止一个已经在跑的查询，`loading` 只是禁用按钮。
- **根因分析**：把 SQL Editor 当成本地 psql 使用，忽略了它是"多租户共享进程里的一个 HTTP 请求"。DTO 只有 `@IsString() @MinLength(1)`，没有 `@MaxLength`（当前实际被 Express 默认 100kb JSON body 上限兜住，但那是框架副作用，不是设计）。
- **影响范围**：单条慢查询即可占满 Neon 连接额度与 API 事件循环（大结果集序列化是同步 CPU 密集操作）；并发几条即可造成整体不可用。
- **修复建议**：事务内 `SET LOCAL statement_timeout = '15s'`（可配置）与 `lock_timeout`；对 SELECT 强制注入行数上限（外层包 `SELECT * FROM (<stmt>) t LIMIT n+1` 并标记截断）或改游标分页；`queryHistory` 与响应体限制大小；前端加 `AbortController`，服务端提供取消入口（Neon HTTP 无 session 取消，需评估改走 session 连接或直接依赖 statement_timeout）。
- **依赖/关联**：SE-008（超时错误的分类展示）。
- **验证方式**：`pg_sleep` 超过阈值应返回明确超时错误而非挂起；`SELECT * FROM big_table` 返回行数受限且有截断标记；并发压测下实例内存与连接数有上界。

## [SE-006] `SET LOCAL` 是静默失败型护栏，且与 Neon batch 的隐式事务语义强耦合

- **优先级**：P2
- **置信度**：已确认（PostgreSQL 语义）；当前是否生效取决于 Neon batch 端点行为，待真实环境验证
- **问题类型**：正确性 / 隐式契约 / 安全边界脆弱
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts:123-131`
- **调用链**：`neonSql.transaction([...])` → 驱动把数组打包为 `{queries:[...]}` 单次 POST 到 batch 端点 → 服务端在同一隐式事务内顺序执行 → `SET LOCAL` 仅在该事务内有效。
- **触发条件与最小复现**：把 `transaction()` 换成两次 `sql.query()`（或换成 session 连接池、加一层中间件拆分语句）后执行 `SELECT * FROM orders`。`SET LOCAL` 在事务块外只产生 `WARNING: SET LOCAL can only be used in transaction blocks`，**不抛错**，`search_path` 回落默认 `"$user", public`。
- **问题描述**：整个租户隔离建立在"这两条语句一定在同一个事务里"这一隐式契约上，而代码没有任何断言或注释说明这个依赖。契约一旦失效，失败方式是静默的：查询照常成功，只是解析到了 `public`；更糟的是 `CREATE TABLE foo` 这类 DDL 会直接落进 `public`，把"读错表"升级成"写进公共 schema"。
- **根因分析**：依赖了驱动的实现细节（batch 端点的隐式事务）而没有把它显式化，也没有在生效后做校验。属于典型的 fail-silent 设计，违反项目"fail fast and loudly"的约定。
- **影响范围**：驱动升级、换成 session 连接、加中间件、拆分语句都可能无声地让隔离失效；排查成本极高，因为现象是"偶尔查到别人的数据"。
- **修复建议**：改用 `SELECT set_config('search_path', $1, true)`（值走参数绑定，同时消除 `txn.unsafe` 手拼标识符）；在同一事务内执行 `SHOW search_path` 并断言等于期望值，不一致直接抛错；长期改由 `SET LOCAL ROLE proj_x_role` 承担隔离，即使 `search_path` 失效也无法越界。
- **依赖/关联**：SE-001（同一处代码）；SE-002（真正的边界应来自角色）。
- **验证方式**：单测中断言事务内 `SHOW search_path` 返回项目 schema；故意改成非事务执行时应当抛错而不是静默成功。

## [SE-007] `split(';')` 判断单语句产生假阳性，合法查询被拒

- **优先级**：P2
- **置信度**：已确认
- **问题类型**：功能正确性 / 误报
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts:25-42`
- **触发条件与最小复现**：以下**单条**合法语句都会被拒绝并提示"Only one SQL statement per run"：`SELECT 'a;b';`、`CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;`、`SELECT 1 -- 注释里的分号;`。
- **问题描述**：用字符串 `split(';')` 近似词法分析，无法区分字符串字面量、美元引用、注释与真正的语句分隔符。
- **根因分析**：SQL 的分号只有在词法层面才是分隔符，纯字符串处理必然误判。
- **影响范围**：用户无法执行含分号的字符串常量、函数定义、注释，功能可用性受损；同时给人"已经做了语句级防护"的错觉（实际防护价值见 SE-003）。
- **修复建议**：用真正的 SQL 词法/语法解析（`libpg-query`、`pgsql-ast-parser` 等）得到语句列表与语句类型；若只想保留"单语句"约束，至少实现一个能识别 `'...'`、`"..."`、`$$...$$`、`--`、`/* */` 的扫描器。
- **依赖/关联**：SE-003（解析结果应同时用于语句类型判断，替换黑名单）。
- **验证方式**：上述三条语句应成功执行；真正的两语句 `SELECT 1; SELECT 2` 仍被拒。

## [SE-008] 所有错误被压成 400，并把 PostgreSQL 原始错误信息回传前端

- **优先级**：P2
- **置信度**：已确认
- **问题类型**：错误语义 / 信息泄露
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts:153-156`、`apps/web/src/features/sql-editor/sql-editor-client.tsx:79-84,194-200`
- **触发条件与最小复现**：断开数据库连接后提交任意 SQL，返回 `400 Bad Request` 而非 5xx；提交 `SELECT * FROM proj_9f3a.orders WHERE id = 'abc'`，错误信息会回传列名、类型不匹配细节与 `hint`。
- **问题描述**：`catch (err)` 捕获包括数据库不可达、网络超时、Neon 配额超限在内的所有异常，统一包装成 `BadRequestException(message)`，前端无法区分"我的 SQL 写错了"和"服务挂了"。同时 `err.message` 原样回传，包含 `schema`、`table`、`column`、`detail`、`hint`，可用于枚举其他租户的表结构。
- **根因分析**：缺少错误分类层；把 `NeonDbError` 的 `code`（如 `42P01`、`42601`、`57014`）直接丢弃，只保留自由文本。
- **影响范围**：可观测性缺失（4xx 与 5xx 混在一起，告警与重试策略都失效）；跨租户 schema 探测；前端把原始错误直接渲染给用户。
- **修复建议**：按 `NeonDbError.code` 分类——SQL 语法/对象错误映射为 400 并保留脱敏后的 `message`/`position`；连接、超时、配额类映射为 503/504；对 `schema`/`table`/`column`/`hint` 做脱敏或只落日志不回传；日志中记录完整错误与 request id。
- **依赖/关联**：SE-005（超时错误需要独立语义）；SE-004（日志需要操作主体）。
- **验证方式**：数据库不可达时返回 5xx；语法错误返回 400 且不含其他 schema 名称；`position` 可用于前端高亮。

## [SE-009] 历史写入位于事务之外且被同一个 `catch` 覆盖，已提交的写操作会被报告为失败

- **优先级**：P2
- **置信度**：已确认（与 `fixes/database/issues.md` DB-002 同一问题，此处补充与 SQL Editor 授权/审计的关联）
- **问题类型**：事务语义 / 误导性错误
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts:118-156`
- **触发条件与最小复现**：执行一条 `UPDATE`，同时让 `query_history` 插入失败（表被锁、连接抖动、`rowCount` 为 null 触发 not-null 约束）。
- **问题描述**：用户 SQL 的事务已 `COMMIT`，随后 `queryHistory` 插入失败，外层 `catch` 返回 `BadRequestException`。用户看到"失败"，但数据已经改了；重试即重复写入。
- **根因分析**：执行与审计是两次独立请求、两个事务，`try` 覆盖了两个阶段，没有区分"业务结果"与"审计结果"。
- **影响范围**：非幂等写操作被重复执行；审计缺口与响应语义不一致。DDL 场景（如 `ALTER TABLE`）重试会直接报错，进一步误导。
- **修复建议**：把审计写入移出 `try`，失败只记录结构化日志并（可选）在响应里带 `auditFailed: true`，不改变业务结果；需要强审计时用 outbox 或独立可靠通道。
- **依赖/关联**：SE-004（审计字段）；SE-010（`rowCount` 为 null 的规范化问题）。
- **验证方式**：模拟审计插入失败，断言响应为成功且目标数据已变更；日志中出现审计失败记录。

## [SE-010] 结果规范化依赖 `rows[0]` 与数组位置，空结果与重名列会丢信息

- **优先级**：P2
- **置信度**：已确认
- **问题类型**：结果正确性 / 前端展示
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts:61-73,134-137`、`packages/types/src` 的 `QueryResult`
- **触发条件与最小复现**：执行 `SELECT * FROM empty_table;` → `columns` 为 `[]`，前端无法渲染表头（只能显示"Query returned 0 rows"）；执行 `SELECT 1 AS a, 2 AS a;` 或含同名列的 JOIN → 其中一列被静默丢弃；执行 `CREATE TABLE t(...)` → `rowCount` 回退为 0。
- **问题描述**：`columns` 由 `Object.keys(rows[0])` 推导，而 `fullResults: true` 的返回里本来就有 `fields`（含列名与类型），被忽略了。结果集通过 `results[results.length - 1]` 按位置取，语句数量一变就会静默错位。
- **根因分析**：把 Neon 的对象行格式当成"天然带列信息"，忽略了零行与重名列两个边界。
- **影响范围**：空结果集的前端展示退化；同名列数据静默丢失（对 JOIN 查询尤其危险，用户看到的数据是错的）；`rowCount` 对 DDL 语义不准。
- **修复建议**：用 `fullResults` 的 `fields` 生成 `columns`（含重名去重编号，如 `a`、`a_2`）；显式按索引取目标结果而不是 `length - 1`；对 DDL/非 SELECT 命令返回独立的 `affectedRows` 语义。
- **依赖/关联**：SE-008（字段类型可用于错误提示）；SE-011（前端按 `columns` 渲染）。
- **验证方式**：空结果集返回正确列名；重名列两列都在且值不串；DDL 的 `rowCount` 语义明确。

## [SE-011] 前端默认查询直接指向 `public.users`，历史乐观更新伪造 `projectId`

- **优先级**：P3
- **置信度**：已确认
- **问题类型**：默认配置风险 / 类型一致性
- **涉及文件**：`apps/web/src/features/sql-editor/sql-editor-client.tsx:51,89-99`、`apps/web/src/features/sql-editor/sql-editor-helpers.server.ts:13-21`
- **触发条件与最小复现**：打开任意项目的 SQL Editor，直接点 Run（默认内容 `SELECT * FROM users LIMIT 10;`）；执行成功后查看历史面板项。
- **问题描述**：默认编辑器内容是一个未限定 schema 的 `users` 查询。在 SE-001 未修复时，这行默认内容就是跨租户读取的最小复现路径，而且它看起来像"示例代码"，用户不会怀疑。历史乐观更新把 `projectId` 填成 `projectSlug`（类型上是 uuid），`id` 用 `crypto.randomUUID()` 本地生成，与服务端真实记录不一致，刷新后条目会"变样"。
- **根因分析**：默认值只考虑"演示效果"，没有考虑它同时是一个可执行的特权查询；前端乐观更新没有使用服务端返回的记录。
- **影响范围**：默认即泄露；历史列表出现重复/幽灵条目，`projectId` 类型不实（`QueryHistoryItem.projectId` 声明为 string，实际语义为 uuid）。
- **修复建议**：默认内容改为 `SELECT * FROM <当前 schema 中的表> LIMIT 10`（从 `getTables()` 取第一张表），或干脆留空；历史改用接口返回的记录，或执行后重新拉取 `/sql/history`。
- **依赖/关联**：SE-001（默认查询的实际影响）；SE-004（历史可见性）。
- **验证方式**：默认内容不含未限定名；执行后历史条目与服务端返回一致且无重复。
