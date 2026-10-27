# SQL Editor 深度审查修复建议

> 以下为修复方案记录，示例代码是设计草图而非现有实现。
> 落地顺序：先做 **SE-002/SE-003**（数据库角色 + 只读事务）建立真正的边界，再做 **SE-001**（收紧 `search_path`），否则只是把"读错表"换成"全限定名直读"。**SE-004/SE-005** 可与前两项同批上线，**SE-006~SE-011** 作为正确性与体验收尾。

## SE-001：把 `search_path` 收紧到项目 schema，并把控制面迁出 `public`

**推荐方案**

1. `search_path` 只保留项目 schema 本身，**不放 `public`**：

   ```ts
   await neonSql.transaction(
     (txn) => [
       // 用 set_config 让 schema 名走参数绑定，而不是拼进 SQL 文本
       txn`SELECT set_config('search_path', ${project.dbSchema}, true)`,
       txn`SELECT set_config('statement_timeout', ${'15s'}, true)`,
       txn`${txn.unsafe(statement)}`,
     ],
     { fullResults: true, readOnly: isReadOnly(statement) },
   );
   ```

   注意 `set_config` 的第二个参数是**值**（text），可以绑定；这比 `SET LOCAL search_path TO ${txn.unsafe(...)}` 少依赖一层 `assertSafeIdentifier` 正则。

2. 在同一事务里断言生效结果，不要假设它生效：

   ```ts
   const [{ search_path }] = await txn`SHOW search_path`;
   if (search_path !== `"${project.dbSchema}"`) throw new Error(...);
   ```

   这同时覆盖 SE-006：`SET LOCAL` 一旦因脱离事务块而静默失效，这里会直接报错。

3. 控制面表迁出 `public`：新增 `novabase` schema 承载 `users`/`organizations`/`projects`/`org_members`/`query_history`/`storage_*`，Drizzle `pgSchema('novabase')`，并**不授权给项目角色**。这一步需要一次迁移 + 全量回归，但它是 SE-001 与 SE-002 的共同前置。

4. 盘点并清理 `public` 里已有的业务对象（历史遗留、脚本建的表）。清理前先只读盘点：

   ```sql
   SELECT n.nspname, c.relname, c.relowner
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','S');
   ```

**替代方案**：保留 `public` 但把所有控制面表加上 RLS 并默认拒绝。改动小，但 RLS 只保护表，不保护 schema 内的函数/类型/操作符，且 `public` 仍是所有租户可写的共享命名空间，不推荐。

**回归风险**

- 去掉 `public` 后，装在 `public` 里的扩展函数（如 `uuid-ossp` 的 `uuid_generate_v4()`、`citext` 类型）将不可解析。`gen_random_uuid()` 属于 `pg_catalog`，不受影响。上线前需要盘点 `public` 内的扩展对象，把需要的 schema 显式加进 `search_path` 或迁移扩展。
- 前端默认查询、文档示例、内部脚本里所有未限定名的表引用都会开始报 `42P01`——这是**期望行为**，但需要提前通知。

**涉及范围**：`SqlEditorService.executeQuery`、`ProjectsService.provisionSchema`、`db/schema/*`、`apps/api/drizzle/` 迁移、`apps/web` 默认查询。

**验收**：项目 schema 缺表时返回 `42P01`；`SELECT * FROM public.users` 被数据库拒绝；两个项目的同名表互不串数据。

## SE-002：用数据库角色建立真正的租户边界

**推荐方案**

1. 建项目时同步创建角色（`ProjectsService.createProject`）：

   ```sql
   CREATE ROLE "proj_9f3a" NOLOGIN;
   GRANT USAGE, CREATE ON SCHEMA "proj_9f3a" TO "proj_9f3a";
   ALTER DEFAULT PRIVILEGES IN SCHEMA "proj_9f3a"
     GRANT ALL ON TABLES TO "proj_9f3a";
   ```

   把角色名存进 `projects` 表（新增 `dbRole` 字段），与 `dbSchema` 同生命周期。

2. 收紧 `public` 与跨 schema 权限（一次性、全局）：

   ```sql
   REVOKE ALL ON SCHEMA public FROM PUBLIC;
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
   ```

3. 执行用户 SQL 前切换角色。**角色名是标识符，不能用参数绑定**，因此必须走严格校验 + 引号，并保证名字来自数据库而非用户输入：

   ```ts
   assertSafeIdentifier(project.dbRole, 'project role');
   txn`SET LOCAL ROLE ${txn.unsafe(`"${project.dbRole}"`)}`;
   ```

   项目角色应是 `NOLOGIN`，由平台 owner 角色 `SET ROLE` 切换，这样连接池无需为每个项目维护凭据。

4. 终态可选：项目独立 database（Neon 支持一个项目下多个 database），连接串按项目派生，物理隔离，代价是连接开销与迁移管理复杂度。

**替代方案**：不做角色，只做 SE-001 + 严格语句白名单。这能挡住"误读"，挡不住"故意越界"，不满足多租户产品的安全要求。

**回归风险**：`SET LOCAL ROLE` 后，项目角色对 `information_schema` 的可见范围会收窄，表编辑器的元数据查询需要确认仍可用；`ALTER DEFAULT PRIVILEGES` 只对之后创建的对象生效，存量表需要补 `GRANT`。

**涉及范围**：`ProjectsService`、`SqlEditorService`、`TableEditorService`（同样应切角色）、`drizzle` 迁移、部署脚本。

**验收**：事务内 `SELECT current_user` 返回项目角色；`SELECT * FROM proj_other.t`、`DROP TABLE`、`CREATE SCHEMA` 全部被数据库拒绝。

## SE-003：默认只读 + 用解析结果替代字符串黑名单

**推荐方案**

1. 先恢复驱动已经提供的护栏——按语句类型决定事务属性：

   ```ts
   const READ_ONLY_COMMANDS = new Set(['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'VALUES']);
   const { command } = parse(statement);            // 见 SE-007
   const readOnly = READ_ONLY_COMMANDS.has(command);
   await neonSql.transaction(queries, { fullResults: true, readOnly });
   ```

   驱动会把它转成 `Neon-Batch-Read-Only` 头，服务端把事务置为 READ ONLY，写操作在数据库层失败。这是不依赖任何字符串判断的硬护栏。

2. 删除 `blocked` 数组与 `startsWith` 判断。语句类型判定交给解析器，对象范围判定交给数据库角色（SE-002）。

3. 若产品确实要限制 DDL（哪怕对管理员），在解析结果上做**白名单**：只允许 `SELECT/INSERT/UPDATE/DELETE` + 受控的 `CREATE TABLE/ALTER TABLE`，显式拒绝 `CREATE FUNCTION`、`DO`、`COPY ... FROM PROGRAM`、`GRANT`、`SET ROLE` 等。

**替代方案**：保留黑名单但改为"注释剥离 + 归一化空白 + 全词匹配"。比现在好，但仍是黑名单思路，漏一个就是洞，只适合作为过渡。

**回归风险**：`WITH ... DELETE`（CTE 里带写操作）会被识别为 `WITH` 从而误判为只读——必须在解析结果里检查 CTE 内是否含写节点，而不是只看首关键字。

**涉及范围**：`SqlEditorService.parseSingleStatement/executeQuery`、新增 `sql-parser` 工具模块。

**验收**：注释、双空格、大小写、`WITH ... DELETE`、`DO $$ ... $$` 变体全部按预期分类；只读事务下写操作返回只读错误。

## SE-004：限定管理员角色并补齐审计主体

**推荐方案**

1. 控制器加角色约束：

   ```ts
   @Post()
   @RequireOrgRole('admin')
   executeQuery(...)
   ```

   若产品需要"项目级"权限，则在 `projects` 上加成员/角色表，而不是复用组织角色。

2. `query_history` 增加主体与上下文（需要一次 Drizzle 迁移，存量行 `userId` 先允许 null，再逐步收紧）：

   ```
   user_id     uuid not null references users(id)
   org_id      uuid not null references organizations(id)
   command     text not null      -- SELECT / UPDATE / DDL
   target      text               -- 主要对象（表名），用于审计检索
   error_code  text               -- 失败时记录 PG code
   ```

3. `getHistory()` 默认按 `userId` 过滤；如需"项目共享历史"，在产品层显式开关，而不是默认全组织可见。

**替代方案**：只加 `userId` 不改权限，先解决"能追责"再解决"谁能做"。可作为第一阶段。

**回归风险**：`RequireOrgRole` 目前只支持单一角色值，`owner` 需要额外处理（守卫当前是 `member.role !== requiredRole` 严格相等）；需要确认 `OrgRole` 枚举与 `admin`/`owner` 的实际取值。

**涉及范围**：`SqlEditorController`、`SqlEditorService.getHistory`、`db/schema/query-history.ts`、`apps/api/drizzle/`、`apps/web` 历史面板。

**验收**：`viewer` 调用返回 403；成功/失败的执行都有带 `userId` 的记录；历史接口不返回他人记录。

## SE-005：给查询加时间与体量预算，并提供取消

**推荐方案**

1. 事务内设置超时（`statement_timeout` 与 `lock_timeout` 都设，避免 DDL 卡在锁上）：

   ```ts
   txn`SELECT set_config('statement_timeout', ${'15s'}, true)`,
   txn`SELECT set_config('lock_timeout', ${'3s'}, true)`,
   ```

2. 限制返回行数。最稳的做法是在同一事务里用游标取前 N+1 行，避免把全表读进 Node 内存：

   ```ts
   txn`DECLARE novabase_cursor NO SCROLL CURSOR FOR ${txn.unsafe(statement)}`,
   txn`FETCH FORWARD ${MAX_ROWS + 1} FROM novabase_cursor`,
   ```

   返回 `MAX_ROWS + 1` 行即说明被截断，响应里带 `truncated: true`，前端提示"仅显示前 N 行"。**仅对返回结果集的语句（SELECT/WITH/VALUES/EXPLAIN）这样做**，DDL/DML 走原路径。

3. 前端加取消：`AbortController` 中止 HTTP 请求，服务端在超时之外没有真正的取消通道（Neon HTTP 无 session 级 `pg_cancel_backend`），因此**取消的语义必须定义为"客户端不再等待"，服务端查询仍受 `statement_timeout` 兜底**。不要向用户承诺"已终止"。

4. DTO 增加 `@MaxLength(20000)` 之类的显式上限，不要依赖 Express 默认 100kb。

**替代方案**：只做 `statement_timeout` + 结果行数上限，不做游标（实现简单，但大结果集仍会先被驱动读进内存）。可作为第一阶段。

**回归风险**：游标方案要求语句是"返回结果集的单条语句"，`EXPLAIN`、`VALUES`、`WITH` 都支持，但 `SELECT ... FOR UPDATE` 在 `NO SCROLL` 下行为需要验证；`DECLARE` 与 `FETCH` 必须在同一事务内，与 SE-006 的事务契约绑定。

**涉及范围**：`SqlEditorService.executeQuery`、`ExecuteQueryDto`、`apps/web/sql-editor-client.tsx`、`packages/types` 的 `QueryResult`（新增 `truncated`）。

**验收**：`pg_sleep(600)` 在超时后返回明确错误；大表查询返回行数受限且标记截断；并发压测内存与连接数有上界。

## SE-006：把"必须在同一事务"从隐式契约变成显式断言

**推荐方案**

- 用 `set_config(name, value, true)` 代替 `SET LOCAL`（值可绑定，且语义相同）。
- 在同一事务内 `SHOW search_path` 断言，不一致直接抛错（见 SE-001 第 2 点）。
- 在 `getNeonClient()` 上加注释说明依赖 Neon batch 端点的隐式事务语义，并在升级 `@neondatabase/serverless` 时把这条纳入回归清单。
- 终态由 `SET LOCAL ROLE` 承担边界（SE-002），这样即使 `search_path` 失效也不会越界。

**替代方案**：改用 session 连接（`Client` + WebSocket）显式 `BEGIN/COMMIT`，语义最清晰，但要自己管理连接池与泄漏，且与现有 HTTP Drizzle provider 的架构不一致，不推荐在当前阶段切换。

**回归风险**：`SHOW search_path` 的返回值格式与 PostgreSQL 版本相关（是否带引号、是否含 `"$user"`），断言需要规范化后比较。

**验收**：故意改成非事务执行时，接口应报错而不是静默成功。

## SE-007：用词法/语法解析替代 `split(';')`

**推荐方案**

- 引入 `libpg-query`（PostgreSQL 官方解析器的 WASM 绑定）或 `pgsql-ast-parser`，`parse()` 一次同时拿到：语句列表、每条的 `command`、涉及的对象名。一个解析结果同时服务 SE-003 的只读判定、SE-007 的单语句校验、SE-010 的列类型。
- 若暂不引入依赖，至少实现一个能识别 `'...'`（含 `''` 转义）、`"..."`、`$$...$$`/`$tag$...$tag$`、`--` 行注释、`/* */` 块注释的分号扫描器。
- 保留"单语句"限制时，报错信息要指出第几条语句，而不是笼统提示。

**替代方案**：去掉单语句限制，改为"允许执行但逐条按类型判定"。更贴近真实 SQL Editor 的使用习惯，但需要逐条返回结果集，前端改造量大。

**回归风险**：`libpg-query` 是 WASM，需确认在 Nest 的构建与部署环境（含出站代理配置）下能正常加载。

**验收**：含分号的字符串常量、美元引用函数体、带分号的注释均可执行；真正的多语句被拒且报错定位准确。

## SE-008：错误分类与信息脱敏

**推荐方案**

1. 按 `NeonDbError.code` 分类：

   ```ts
   const CLIENT_CODES = new Set(['42601','42P01','42703','42883','22P02','23505','23503','57014']);
   ```

   - `CLIENT_CODES` → 400，返回脱敏后的 `message` + `position`；
   - 连接/网络/配额 → 503/504，返回固定文案 + request id；
   - 其余 → 500，只回固定文案，细节进日志。

2. 不回传 `schema`、`table`、`column`、`hint`、`detail`、`internalQuery`——这些字段能直接暴露其他租户的对象名。
3. 日志里记录完整错误 + `userId` + `projectId` + `requestId`，并在响应头带上 `requestId` 供用户报障。

**替代方案**：全部映射为 400 但脱敏。改动最小，但可观测性仍然差。

**回归风险**：脱敏后用户排查变难，需要在 UI 上给出"错误码 + request id"并配一份错误码说明。

**验收**：数据库不可达返回 5xx；语法错误返回 400 且不含其他 schema 名；`position` 可用于前端高亮。

## SE-009：把审计写入移出业务结果的 `try`

**推荐方案**

```ts
const result = await runUserSql(...);          // 失败即抛，语义清晰
try {
  await this.drizzle.db.insert(queryHistory).values({ ... });
} catch (err) {
  this.logger.error({ err, projectId, userId }, 'query history write failed');
  // 不影响业务结果；如需强一致审计，改走 outbox
}
return result;
```

若产品要求"没有审计就不允许执行"，则反过来：先写一条 `pending` 审计（含主体与 SQL），执行后更新状态。这属于审计先行模式，代价是多一次写入。

**替代方案**：把审计写进与用户 SQL 同一个事务（Neon batch 里加第三条语句）。原子性最好，但审计失败会回滚用户的 DDL/DML，对 SQL Editor 来说体验很差，不推荐。

**验收**：模拟审计插入失败，响应为成功且目标数据已变更；日志中出现审计失败记录。

## SE-010：用 `fields` 生成列信息，按索引取结果

**推荐方案**

- `normalizePgResult` 改为接收明确的查询序号，而不是 `results[results.length - 1]`。
- `columns` 从 `result.fields` 取（`fullResults: true` 时驱动返回 `{ name, dataTypeID }`），空结果集也能拿到列名；重名列做去重编号。
- `rows` 若仍用对象格式，重名列会被覆盖——**必须**在检测到重名列时改用数组行（`arrayMode`）或重命名键。
- DDL/DML 返回 `affectedRows`，不要复用 `rowCount` 的 SELECT 语义。

**替代方案**：前端按 `fields` 的 `dataTypeID` 做类型化渲染（数字右对齐、时间格式化），属于后续增强。

**回归风险**：`arrayMode` 与 `fullResults` 组合时返回结构不同，需要一次性对齐 `packages/types` 的 `QueryResult`。

**验收**：空结果集返回正确列名；`SELECT 1 AS a, 2 AS a` 两列都在且值不串；DDL 的 `rowCount` 语义明确。

## SE-011：前端默认值与历史一致性

**推荐方案**

- 默认编辑器内容改为从 `getTables()` 取第一张表生成 `SELECT * FROM "schema"."table" LIMIT 10;`（带 schema 前缀），没有表时留空并给出提示。
- 执行成功后重新拉取 `/sql/history`（或直接使用响应里带回的记录），不要本地伪造 `projectId`/`id`。
- 错误展示区分 4xx/5xx：4xx 显示数据库错误文案，5xx 显示"服务异常，请稍后重试（request id）"。

**替代方案**：保留乐观更新但用服务端返回的真实记录替换（响应里回传 `historyId`）。

**验收**：默认内容不含未限定名；执行后历史条目与服务端一致且无重复。
