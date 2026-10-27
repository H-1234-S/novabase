# Realtime 第二轮深度审查摘要

## 修复实施状态（2026-10-22）

以下状态来自当前工作区实现和本地 mock/unit 验证；它们不代表已在 Neon/PostgreSQL 上完成集成验收。

| 编号 | 当前状态 | 实现或剩余工作 |
|---|---|---|
| RT-001 | 已修复（真实 DB 尚待验证） | Gateway/Service 仅接受受限标识符；监听 channel 改为固定长度服务器 hash；只允许已启用表；动态 LISTEN/UNLISTEN identifier 使用引用。测试验证恶意 payload 不建连接。隔离 Neon/PG 的驱动验证及独立最小权限 `REALTIME_DATABASE_URL` 仍需部署验证。 |
| RT-002 | 已实现恢复和清理（真实驱动待验） | connecting entry 单飞、connect/LISTEN 失败清理、运行时 error/end 退避重连、UNLISTEN/end 和 shutdown 清理。退避延迟上限 30 秒并持续重试；Neon 真实断线行为尚未验证。 |
| RT-003 | 已实施应用层上限 | 仅可订阅实际启用的表；每 socket 10 个订阅，默认每 API 进程每项目 200 个订阅、200 个 channel，全进程 2000 个订阅；每项目 500 个 socket、每进程 2000 个 socket。Service 限额可由 `REALTIME_MAX_SUBSCRIPTIONS`、`REALTIME_MAX_SUBSCRIPTIONS_PER_PROJECT`、`REALTIME_MAX_CHANNELS` 调整；Gateway socket 上限可由 `REALTIME_MAX_SOCKETS_PER_PROJECT`、`REALTIME_MAX_SOCKETS` 调整。多实例部署的总数据库连接/Socket 预算为单实例上限乘实例数，仍需用目标 Neon 配额校准默认值。 |
| RT-004 | 行数据泄露已消除；ACL 策略待产品确认 | 新 trigger 不再广播 NEW/OLD 行，只广播 project/table/operation/time 元数据。持有项目 anon key 的客户端仍可订阅被显式启用表并观察变更元数据；是否需要仅管理端或终端用户级 ACL 仍需产品决策。 |
| RT-005 | 已修复（PG 集成待验） | Trigger payload 固定为小型 invalidation event，避免完整行超出 NOTIFY 限制并导致业务事务失败。 |
| RT-006 | 已修复并有竞态测试 | Service 同 channel 共用初始化 Promise；Gateway 在 await 前登记 pending 状态，退订/断连后完成的订阅会被撤销。 |
| RT-007 | 已增加 outbox/cursor 回放（Neon/PostgreSQL 集成待验） | 每个项目 schema 使用事务 outbox 保存紧凑变更事件；订阅可携带 `since` cursor，服务端在订阅前及入房后回放并按 seq 去重。保留期内可补逐条事件，超期返回 `CURSOR_EXPIRED` 并由 Web UI 快照重同步。SDK 暴露 cursor/error callback。 |
| RT-008 | 已修复（PG 标识符验证待验） | channel/function/trigger 使用短 hash 名，避免 PostgreSQL 63-byte identifier 截断碰撞。 |

**旧 trigger rollout 注意**：已存在的旧版 trigger 仍发送旧 channel 和完整行 payload。服务端只认新 hash trigger；为升级某表，需通过管理端再次启用该表 Realtime（调用现有 enable endpoint），它会替换该表旧 trigger。完成所有表迁移前，旧 trigger 仍可能因大行 payload 使 DML 失败。请在目标部署安排逐表迁移并优先检查大字段表。

**深度审查时的验证记录（历史）**：当时只做源码审查，没有运行测试或 SQL；下方“实施状态”和本目录的 `outbox-implementation-report.md` 记录之后的修复与验证。原始问题统计反映修复前发现，不应当作当前未修复问题数。

## 审查范围

基于当前工作区源码和依赖锁版本审查：

- `apps/api/src/realtime/{gateways,realtime.service.ts,trigger.service.ts,realtime.controller.ts,types}`
- `apps/web/src/features/realtime/` 的连接、订阅、重连 UI
- `apps/api/src/project-api/guards/project-key.guard.ts`、`apps/api/src/projects/projects.service.ts`、Drizzle DB provider 与 shared realtime types/constants
- `@neondatabase/serverless` 1.1.0 本地安装代码；Socket.IO server/client 锁定 4.8.4（lockfile 同时存在 4.8.3 的依赖项）
- PostgreSQL 官方 protocol、LISTEN/NOTIFY 和 identifier 规则

原始深度审查轮只读源码/文档/依赖，不运行应用、测试或 SQL。后续实施记录见 `outbox-implementation-report.md`。详细审查调用图见 `execution-flow.md`。

## 问题状态与统计

共 **8 项**：P1 4 项、P2 4 项。

| 编号 | 优先级 | 状态 | 摘要 |
|---|---:|---|---|
| RT-001 | P1 | 注入已确认，权限影响依赖 DB grants | subscribe payload 进入 Neon simple-query 文本，协议支持分号多语句；WebSocket 绕开 HTTP 标识符校验。 |
| RT-002 | P1 | 已确认 | client 初始化失败/连接 error 后无一致清理、重连；Map/room/socket callback 分裂。 |
| RT-003 | P1 | 已确认 | 每个新 channel 一条长期 DB Client，无表验证/数量与速率上限；公开 anon key 可耗尽连接。 |
| RT-004 | P2 | 行为确认，产品授权语义待确认 | anon key 可订阅已启用表并接收完整 NEW/OLD 行，角色未参与表授权。 |
| RT-005 | P2 | PostgreSQL 默认配置下已确认 | 全行 JSON 超过 NOTIFY 8000-byte payload 限制（必须小于 8000 bytes）会使写事务失败。 |
| RT-006 | P1 | 已确认 | 并发首订阅 Map 覆盖 Client；subscribe await 期间断开/退订会遗留状态。 |
| RT-007 | P2 | 已确认 | NOTIFY 无回放；断线期间事件丢失；前端无 subscribe ACK 却先显示 Listening。 |
| RT-008 | P2 | 已确认 | 长表名 + `_notify` 超过 63-byte 标识符长度，共用函数导致事件错投/串表。 |

已有 RT-001 原“高度疑似”被依赖代码和 PostgreSQL simple-query 协议进一步验证：不再仅根据字符串拼接断言。实际可执行的 SQL 语句和影响范围仍受 SQL 语法、Neon 限制及 DB role 权限约束。已有 RT-002 被扩展为连接失败、状态分裂、初始化竞态和清理边界；独立 race 编号为 RT-006。

## 已排除/没有证据定为缺陷的点

- 正常生成的项目 UUID 在 channel 和 room 中都带 projectId，当前事件路径具备项目级隔离；本轮未发现普通合法 key 之间直接跨项目 room 广播。
- 多个客户端正常共享一个已建 channel 时 callback `Set` 让单个 callback 退订不影响其他 callback；最后 callback 才触发 UNLISTEN。问题在并发初始化和失败/断开交错，见 RT-006。
- 当前未配置跨进程 Socket.IO adapter。由于每进程的订阅者会在该进程创建 DB LISTEN Client，该进程收到通知后向本地 room 广播；没有证据证明当前单实例流程因此重复。多实例 LB/polling sticky session 尚需部署环境确认，不列成已确认缺陷。
- `pg_notify` 在事务提交后发送、队列对 listener 可见是 PostgreSQL 语义；这不等于持久消息队列。需产品决定是否接受 best-effort（RT-007）。

## 推荐修复顺序及依赖

1. **先收紧攻击面**：RT-001 安全构造 SQL、RT-003 订阅限额/连接预算；使用独立最小权限 `REALTIME_DATABASE_URL`。两者应同批上测试环境。
2. **修复状态基座**：RT-006 single-flight channel entry 和 pending socket cancel；再做 RT-002 error/close、退避、shutdown 生命周期。否则 retry 可能放大竞态/连接风暴。
3. **定授权策略**：产品确认 enable 是否公开发布；按结论落实 RT-004 表/字段 ACL。
4. **调整 payload**：RT-005 将全行通知改为小型 key/invalidation；处理 RT-008 唯一函数名与旧 trigger 迁移。
5. **验证持久补偿**：RT-007 已有 outbox/cursor 回放及过期快照降级。优先在真实 PostgreSQL/Neon 验证触发器事务一致性、并发 cursor 顺序、过期水位和清理锁，再决定是否需要更强的消费者 offset/投递确认语义。

每个问题的逐项实现思路、替代方案、风险和验收见 `recommendations.md`；执行顺序需配合 `test-plan.md`。

## 尚未验证与所需环境

- **Neon 权限影响**：核对各环境 `REALTIME_DATABASE_URL` 是否配置；在隔离 DB 查看实际 `current_user` grants。代码只证明缺省会 fallback 到 `DATABASE_URL`，不证明生产凭据权限。
- **驱动真实执行**：本地 `@neondatabase/serverless@1.1.0` bundle 显示无参数字符串走 simple query；需隔离 PostgreSQL/Neon 验证带分号 payload 的实际端到端效果与 Neon policy 限制。
- **运行时断线行为**：fake Client 可验证应用状态机；真实 Neon websocket 测 error/close/end 与断网恢复语义。
- **PostgreSQL trigger 边界**：隔离 PG 验证 8000-byte payload 错误与 DML rollback、identifier truncation 的实际通知名、`CREATE OR REPLACE FUNCTION` 长名碰撞。
- **产品数据策略**：明确 anon key 是否应接收完整启用表的所有字段、是否支持终端用户 JWT/行权限。
- **容量部署**：确认 Neon session quota、API 实例数量、Node heap、Socket.IO transport/LB sticky session 及 graceful shutdown 配置。

官方行为证据链接见各问题条目：PostgreSQL [protocol flow](https://www.postgresql.org/docs/current/protocol-flow.html)、[NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)、[LISTEN](https://www.postgresql.org/docs/current/sql-listen.html) 和 [identifier syntax](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)。

