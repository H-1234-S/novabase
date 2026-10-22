# Realtime 安全分析

## 信任边界

| 边界 | 当前实现 | 安全含义 |
|---|---|---|
| Web 页面 → Socket.IO namespace | `realtime-client.tsx` 把 `anonKey` 放在 `handshake.auth.token`；Gateway 自行验 JWT。Socket CORS origin 来自 `WEB_URL`，但 CORS 不是鉴权。 | anon key 属于公开客户端凭据，不能视为用户身份/保密凭证。 |
| Key → project identity | `handleConnection()` 用 `PROJECT_JWT_SECRET` 验签，校验 role 是 `anon` 或 `service_role`，然后把 claim 中 projectId 写入 socket.data。 | projectId 来自签名 claim，跨项目 room 前缀有效；没有再查 project 记录、key 撤销状态或 per-table policy。100 年期限见 `ProjectsService.signProjectKey()`。 |
| Client → subscribe message | `handleSubscribe()` 接受声明为 string 的消息体，只执行 optional trim；没有 DTO、字符串类型断言、identifier whitelist、项目 schema/table 查询、订阅上限或 ACL。 | 可发送对象/超长值等异常消息；更重要是恶意字符串直达 SQL 和资源创建。 |
| App → database | `getListenConnectionString()` 选 `REALTIME_DATABASE_URL ?? DATABASE_URL`，删除 hostname `-pooler` 及部分参数；没有独立 DB role 创建/授权代码。 | 配置了独立受限 URL 时可缩小损害面；缺省 fallback 会复用 Drizzle 的 DATABASE_URL 权限。部署凭据实际 grants 未知。 |
| DB → Socket rooms | trigger 的 channel 与 event 包含项目 UUID；Gateway room 包含 `projectId/tableName`。回调由当前进程 server emit。 | 项目维度有隔离；项目内没有 role/table/column ACL。room 字符串仍会接收未校验 tableName。 |

## Key 与权限判定的真实链路

- 项目创建生成 `anonKey` 和 `serviceRoleKey`，`ProjectsService.signProjectKey()` 用全局 `PROJECT_JWT_SECRET` 签 `{projectId, role}`，`expiresIn: '100y'`。
- Gateway 不调用 `ProjectKeyGuard`，而是在 `handleConnection()` 自己 verify。同样使用共享 secret，并正确限制 role 的枚举；项目 ID/role 无效类型会由后续判断/代码路径影响，未做完整 schema validation。
- Gateway 将 role 保存到 `client.data.role`，但 `handleSubscribe()` 只读取 projectId；两种 role 对 subscribe 实际权限相同。
- 控制台 HTTP 的 trigger enable/disable 使用 `JwtAuthGuard + OrgRoleGuard`；OrgRoleGuard 确认组织成员但未要求 admin。这个 HTTP 守卫与 WebSocket 订阅授权是两条完全不同的路径。enable 后没有“仅 HTTP 管理员可订阅”的约束。
- Realtime 没有使用终端用户 project-auth JWT，也没有查该用户对行/表的授权。不能将持有 anon project key 等同于登录终端用户。

## RT-001：动态 SQL 证据与边界

**源码可证的数据流**

1. `realtime-client.tsx` 在连接之后发 `subscribe(tableName)`。
2. Gateway 的 payload 类型只有 TS 编译期 string；网络输入运行时不保证类型。它 trim 后立即把表名放进 room，并调用 `RealtimeService.subscribe(projectId, normalizedTable, callback)`。
3. `TriggerService.channelName()` 原样返回 `project_${projectId.replace(/-/g, '_')}_${tableName}`。只有调用 TriggerService enable/disable 的 HTTP 路径校验 `tableName`；Gateway/Service 没有复用校验。
4. `RealtimeService.subscribe()` 执行 `client.query(`LISTEN ${channel}`)`；这是 SQL identifier 位置，非 value 位置。

**驱动与协议证据**

- 锁文件 `pnpm-lock.yaml` 锁定 `@neondatabase/serverless@1.1.0`；`apps/api/node_modules/@neondatabase/serverless/index.js` 是此版本实际安装包。
- bundle 中 `Query.submit()` 的未参数分支调用 `connection.query(this.text)`；Neon Client 的兼容 API 使用的 pg Query 逻辑在无参数、不需 prepare 时将 query text 交给连接层 `query(text)`。
- PostgreSQL simple-query protocol 对 `Query` 文本允许多条分号分隔语句。官方说明：[Message Flow / Multiple Statements in a Simple Query](https://www.postgresql.org/docs/current/protocol-flow.html)。因此，若输入可改变 LISTEN identifier 并加入 `; ...`，它不是只能造成 LISTEN 语法错误的静态字符串问题，而是可利用多语句解析的 SQL 注入通道。
- 代码中没有参数绑定、引用或拒绝分号。最小安全隔离复现可以用附加 `SELECT`，或只写入 disposable test table 的语句；不应在生产 DB 使用破坏语句。

**确定与条件边界**

| 结论 | 级别 | 理由 |
|---|---|---|
| 原始订阅字符串到 LISTEN query 的路径存在 | 已确认 | Gateway、Service 的实际调用链如上。 |
| Client.query(text) 使用可接受多语句的 simple-query 路径 | 已确认 | 本地 Neon 1.1.0 query bundle 路径 + PostgreSQL 官方 protocol 文档。 |
| 一个被签名项目 anonKey 的持有人可触发此路径 | 已确认 | anonKey 被发到浏览器，gateway 接受 anon role 并允许所有 subscribe。 |
| payload 能执行任意 PostgreSQL statement | 条件成立 | statement 需能从 channel 标识符位置正确闭合；simple query 支持多语句。最终执行受 SQL 语法、DB role、Neon 产品限制影响。 |
| 能否跨项目读写/DDL | 待运行配置确认 | `REALTIME_DATABASE_URL` 若缺省就 fallback DATABASE_URL；仓库未配置 grants。查生产 role 的 `current_user`/schema/table privileges 验证。 |
| 表存在性或 HTTP enable 是否提供防护 | 不成立 | gateway 不检查表元数据或 enable 状态；HTTP 校验不在 WS 调用链。 |

**修复安全原则**：简单 ASCII identifier allowlist + schema 表存在/启用记录 + SQL identifier 正确引用 + 独立最小权限 DB role。只加 regex 能阻止语法注入但不能防未授权订阅；只加 ACL 不能防 SQL injection；两者都需要。

## RT-004：项目隔离成立，表级隔离缺失

- **项目边界成立的部分**：项目 key 的签名 claim 中有 projectId；gateway 将 room 前缀限制在该 claim；TriggerService 的 channel 也把从数据库项目行取得的 id 编入 channel。不同项目 UUID 不会自然落入同一个正常 channel/room。
- **项目内边界缺失的部分**：任意 key role 可以订阅任意表名；若 trigger 存在，trigger 将完整 `NEW` 和 `OLD` 编码；所有同 room socket 收到 event。没有字段过滤、行级过滤或启用表查询。
- **产品策略待确认**：控制台“enable realtime”可能设计为显式公开广播，也可能只是开 CDC。源代码无法确定产品期望。若前者，必须在 UI 明示此操作公开该表的全行；若后者，当前是授权缺陷。
- **消息伪造边界**：客户端不能直接触发 server 的 `REALTIME_EVENTS.EVENT` 推送；该 event 只由数据库 notification callback 的 server emitter 产生。客户端可以发送任意 `subscribe`/`unsubscribe` payload，但只改变自己的订阅操作，前提是未利用 RT-001。

## 当前合理的安全隔离点

- `project:${projectId}` 和 `project:${projectId}:table:${tableName}` room 使用项目 key 内的 projectId；不同合法项目 key 的正常订阅不会跨项目广播。
- HTTP trigger 管理使用 JWT Cookie + OrgRoleGuard，并在 controller 查组织 slug 与 projectSlug 的组合；不会直接依赖客户端提交 projectId。
- TriggerService 的 schema/table DDL identifier 至少有 ASCII allowlist 校验。但这不覆盖 WebSocket SQL，也未验证表确实属于预期 schema/项目。

## 需要运行环境核实

1. `REALTIME_DATABASE_URL` 在各环境是否设置、所用数据库角色和 grants；它是否真是非 pooler 直连且隔离。
2. `PROJECT_JWT_SECRET` 是否足够随机/独立；anon key 会被哪些客户端/日志暴露（公开客户端本身预期公开）。
3. 产品对每个启用表的公开字段策略、是否允许包含用户敏感数据。
4. Neon 的 DB connection quota 与部署 Socket.IO 并发上限；用于评估 RT-003 实际拒绝服务容量。
