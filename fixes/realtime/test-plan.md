# Realtime 深度审查测试计划

本文件设计测试，不表示本轮已运行。测试环境不得使用开发/生产数据库凭据；RT-001 payload 只可指向 disposable database/table。

## 测试层次与前置条件

- **Unit**：Vitest 测 `RealtimeGateway`、`RealtimeService`、`TriggerService`；用 fake Neon Client/EventEmitter、deferred Promise 和 fake timers 控制操作顺序。
- **Socket 集成**：起 Nest testing app/Socket.IO client，使用受控 JWT secret 和 test projects；检查 handshake、ACK、room 收发和 disconnect。
- **PostgreSQL 集成**：隔离 PostgreSQL 版本与生产兼容；安装当前项目相同 trigger DDL，真实验证 LISTEN/NOTIFY、payload 限制、事务提交/回滚及数据库 grants。
- **Neon 驱动集成**：使用 `@neondatabase/serverless@1.1.0` + 隔离 Neon DB 或可支持 WebSocket 的测试环境；Mock 只能证实字符串构造，不能证实协议执行/Neon service 限制。
- **容量测试**：有限额的隔离实例，设置保守并发上限，收集 DB active sessions、Node heap、socket count、channel count 和错误率。

## 用例矩阵

| ID | 类型 | 前提与步骤 | 预期结果 | 覆盖 |
|---|---|---|---|---|
| RT-T01 | Gateway unit | mock JWT 返回 anon/service_role/未知 role/过期 token；逐个调用连接处理 | 仅两个已允许 role 通过；invalid 不进入 project room；data 只含验签 claim | 握手认证、role 边界 |
| RT-T02 | Gateway unit | `handleSubscribe` 输入 `"users"`、`"bad-name"`、空白、数字、null、对象、超长 string | 安全 identifier 可继续；其余在调用 DB/加入 room 前被拒绝；有稳定错误 ACK | payload 校验、RT-001 |
| RT-T03 | Neon integration | 用公开测试 anonKey 订阅 `x; SELECT 1; --` 或对 disposable 表执行标记操作 | 修复前确认当前 1.1.0 simple-query 路径执行多语句；修复后 subscribe 在执行前拒绝且标记无变化 | RT-001 驱动真实性 |
| RT-T04 | DB grants integration | Realtime URL 用专用低权限角色；构造误通过应用校验的非本项目 schema SQL | DB role 本身拒绝无关 schema 读写/DDL；验证最小权限纵深防御 | RT-001 影响边界 |
| RT-T05 | Gateway+Service integration | 两 projectId 在相同 tableName 各自订阅；仅 project A trigger 通知 | A 收到事件，B 收不到；事件 payload projectId 与房间所属项目一致 | 项目隔离 |
| RT-T06 | ACL integration | anon key 订阅公开表和敏感/未启用表；再以不同 role 测 | 按明确产品 ACL 矩阵允许/拒绝；敏感字段 oldRecord/newRecord 都不泄露 | RT-004 |
| RT-T07 | Service unit | 两个 subscribe 同步开始，deferred connect/LISTEN；统计 Client 构造、map entry、callback | 一个逻辑 channel 只创建一个 Client；两个 callback 各收到一次通知 | RT-006 single-flight |
| RT-T08 | Service/Gateway race unit | 在 connect 前、connect 后、LISTEN 前/后分别触发 unsubscribe 与 socket disconnect | 取消优先；完成后无 callback、room、Map entry 或 open Client | RT-006 pending cleanup |
| RT-T09 | Service unit | connect reject、LISTEN reject、notification error、close/end、UNLISTEN reject、end reject 分别注入 | 所有路径有捕获日志/错误 ACK；Client 最终关闭；未处理 rejection 数为 0 | RT-002 清理 |
| RT-T10 | Service unit | 用两个 clients 共享一 channel；一个退订，另一个继续；最后一个再退订 | 第一位退订不执行最后关闭；最后一位只执行一次 UNLISTEN/end | 共享 channel 引用计数 |
| RT-T11 | Socket integration | 首次 LISTEN 故意延迟并失败；前端等待 ACK | room/DB 状态回滚；UI 不显示 Listening；收到稳定 error code | RT-002 ack/state sync |
| RT-T12 | PostgreSQL integration | 启用 trigger，commit 后 insert/update/delete；再 rollback 一个事务 | commit 事件发送且字段操作语义正确；rollback 无事件 | 正常 trigger/事务 |
| RT-T13 | PostgreSQL integration | 实时表含大 text/jsonb；写入 payload 计算为 7999 bytes、8000 bytes、超限 | 当前实现边界行为被记录；修复后业务 DML 成功，notification 维持小 payload | RT-005 |
| RT-T14 | PostgreSQL integration | 同事务对同一 row 重复执行会产生相同 JSON event 的更新 | 记录 PostgreSQL 重复 payload 合并语义；若业务要求每次操作皆有事件，outbox sequence 保留每条 | RT-007 去重语义 |
| RT-T15 | Socket+service integration | 订阅后仅断 DB 连接，保留 Socket.IO；期间写入，恢复 DB | service 自动恢复或给客户端明确状态；恢复后的新通知只投递一次 | RT-002 reconnect |
| RT-T16 | Socket integration | 断 Socket.IO，断线期间提交 DML，再重连 | ACK 后订阅恢复；current-state snapshot/cursor 补上断线缺口；不宣称 durable event 时 UI 说明 gap | RT-007 |
| RT-T17 | Capacity/load | anon key 连续订阅随机合法字符串并并发多 socket；逐步逼近配额 | per socket/project/global limit 生效；DB sessions/heap 不越设定预算；超额稳定拒绝 | RT-003 |
| RT-T18 | Shutdown integration | 运行时存在 ready、connecting、retrying、closing channel，触发 Nest app.close() | 所有 client/timer 被 drain；无遗留 socket、Map 项或 teardown unhandled rejection | RT-002 shutdown |
| RT-T19 | Trigger integration | 两个长度超过 PG 标识符可安全生成但前 56 字节相同的表，依次 enable | 验证当前 `${table}_notify` 函数标识符碰撞/第二次替换首函数的可能；修复后函数名唯一且事件各进各 channel | 补充检查：标识符截断 |
| RT-T20 | Frontend integration | 模拟 subscribe ACK 成功/失败、unsubscribe HTTP 失败、重连 | UI 状态只跟随 ACK；HTTP trigger 与 socket listener 状态不一致时提供恢复/提示 | 客户端同步 |

## 稳定复现技巧

- 不用真实计时器猜竞态：fake Client 的 `connect()`/`query(LISTEN)` 返回可由测试逐步 resolve/reject 的 Promise。
- 注入第二次订阅前先暂停第一次 connect；此时检查 `listeners` 是否已占位。分别反转 A/B 完成顺序以触发覆盖问题。
- 对 disconnect race，在 subscribe 进入 service 后立即断开 Socket，再 resolve LISTEN；最后检查 map/callback/client 数，不只检查 room 是否空。
- 对 unhandled rejection，在 test process 监听 `unhandledRejection`；确保 UNLISTEN 和 end reject 后无逃逸异常。
- 对 SQL 注入，Mock 仅断言危险值未抵达 `client.query`；必须再用 Neon 1.1.0 和真实 PG 隔离库证实 query protocol 行为。
- 对 payload byte boundary，按 `Buffer.byteLength(payload, 'utf8')` 计算，而不是 JS 字符长度；Unicode payload 需要测试。

## 验收门槛

- 所有 P1 回归用例通过：RT-T03/T04/T05/T07/T08/T17；没有关键授权/SQL 用例只以 mock 结果代替真实 DB 验证。
- 所有资源路径可观测且清理：失败初始化、disconnect、最后退订、shutdown 后 active Client/Map/timer 都为零。
- 启用 realtime 后，超大数据行不会因为通知大小阻止业务 DML。
- 文档明确事件是 best-effort 通知还是可重放事件；前端成功状态必须由服务器 ACK 驱动。
