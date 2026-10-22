# Realtime 第二轮深度审查摘要

## 审查范围

基于当前工作区源码和依赖锁版本审查：

- `apps/api/src/realtime/{gateways,realtime.service.ts,trigger.service.ts,realtime.controller.ts,types}`
- `apps/web/src/features/realtime/` 的连接、订阅、重连 UI
- `apps/api/src/project-api/guards/project-key.guard.ts`、`apps/api/src/projects/projects.service.ts`、Drizzle DB provider 与 shared realtime types/constants
- `@neondatabase/serverless` 1.1.0 本地安装代码；Socket.IO server/client 锁定 4.8.4（lockfile 同时存在 4.8.3 的依赖项）
- PostgreSQL 官方 protocol、LISTEN/NOTIFY 和 identifier 规则

本轮只读源码/文档/依赖，不运行应用、测试或 SQL，不修改业务源码。现有未提交源码改动保留。详细调用图见 `execution-flow.md`。

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
5. **明确事件语义**：RT-007 增加 subscribe/unsubscribe ACK 和 reconnect snapshot；若要求不丢事件，再设计事务 outbox/cursor，不能只依赖 NOTIFY。

每个问题的逐项实现思路、替代方案、风险和验收见 `recommendations.md`；执行顺序需配合 `test-plan.md`。

## 尚未验证与所需环境

- **Neon 权限影响**：核对各环境 `REALTIME_DATABASE_URL` 是否配置；在隔离 DB 查看实际 `current_user` grants。代码只证明缺省会 fallback 到 `DATABASE_URL`，不证明生产凭据权限。
- **驱动真实执行**：本地 `@neondatabase/serverless@1.1.0` bundle 显示无参数字符串走 simple query；需隔离 PostgreSQL/Neon 验证带分号 payload 的实际端到端效果与 Neon policy 限制。
- **运行时断线行为**：fake Client 可验证应用状态机；真实 Neon websocket 测 error/close/end 与断网恢复语义。
- **PostgreSQL trigger 边界**：隔离 PG 验证 8000-byte payload 错误与 DML rollback、identifier truncation 的实际通知名、`CREATE OR REPLACE FUNCTION` 长名碰撞。
- **产品数据策略**：明确 anon key 是否应接收完整启用表的所有字段、是否支持终端用户 JWT/行权限。
- **容量部署**：确认 Neon session quota、API 实例数量、Node heap、Socket.IO transport/LB sticky session 及 graceful shutdown 配置。

官方行为证据链接见各问题条目：PostgreSQL [protocol flow](https://www.postgresql.org/docs/current/protocol-flow.html)、[NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)、[LISTEN](https://www.postgresql.org/docs/current/sql-listen.html) 和 [identifier syntax](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)。

