# Realtime 深度审查问题

本文件保留并深化原 RT-001、RT-002，并新增源码追踪发现。优先级针对现有公开 key 与部署环境：如果 Realtime 专用数据库账号权限受限，RT-001 的影响面相应收窄，但注入本身仍成立。

## [RT-001] 订阅 payload 可进入 Neon Client simple-query SQL 并执行附加语句

- **优先级**：P1
- **置信度**：注入路径已确认；实际可读写范围取决于运行时 DB role
- **问题类型**：SQL 注入 / 数据完整性
- **涉及文件**：`apps/api/src/realtime/gateways/realtime.gateway.ts:97-129`、`apps/api/src/realtime/realtime.service.ts:44-99`、`apps/api/src/realtime/trigger.service.ts:15-17`
- **调用链**：浏览器 `socket.emit('subscribe', tableName)` → `RealtimeGateway.handleSubscribe()` → `TriggerService.channelName(projectId, tableName)` → `RealtimeService.subscribe()` → `client.query(`LISTEN ${channel}`)`。
- **触发条件与最小复现**：拿到一个项目的公开 anonKey，连接 `/realtime` 后订阅参数以合法片段开头并包含 `; <第二条SQL>; --`，使最终查询形如 `LISTEN project_<signed-project-id>_x; <second statement>; --`。在隔离数据库用 `SELECT 1`/测试表操作作为第二语句验证，不要在生产库验证。
- **问题描述**：Gateway 只调用 `tableName.trim()`，未调用 `TriggerService.assertSafeIdentifier()`。校验只在管理端 HTTP 的 `enableRealtime/disableRealtime` 路径发生，WS 直接到 RealtimeService；`channelName()` 无转义地拼接原始 tableName，最后插入 SQL 标识符位置。
- **根因分析**：仓库锁定 `@neondatabase/serverless` 1.1.0。安装包中 `Query.submit()` 在没有参数、无需 prepare 时调用 `connection.query(this.text)`，该路径发送 simple Query 消息；PostgreSQL simple-query 协议明确允许同一消息包含分号分隔的多条语句。该结论不依赖扩展查询协议的单语句限制。源代码和协议证据见 `security-analysis.md`。
- **已确认事实**：客户端 payload 不受 DTO/标识符白名单校验；服务端字符串插值；Neon 1.1.0 无参数字符串查询走 query-text/simple-query 路径；PostgreSQL simple query 支持多语句。
- **运行时条件/影响边界**：连接选择 `REALTIME_DATABASE_URL ?? DATABASE_URL`。若未配置专用 URL，Realtime 使用同一 DATABASE_URL 用户；仓库没有为 Realtime 创建/配置受限 DB role 的代码。能否执行指定 DDL/DML取决于所配数据库账号 grants、Neon 限制和具体 payload。项目 JWT 只决定 projectId/role，不限制 SQL 内容。
- **影响范围**：最低为对 Realtime DB 用户有权限的 SQL 注入；同凭据连接权限较宽时可跨项目读写。多语句 query 作为一个隐式事务执行；成功的注入语句可能提交。
- **修复建议**：不要把任意客户端输入用作 LISTEN 标识符。将表名校验为简单 ASCII identifier、确认项目 schema 下表存在并且已启用；channel 名由服务器用项目 UUID + 受控表元数据生成。对 SQL identifier 使用正确 quoting/helper；并为 Realtime 配置仅能读必要 schema 元数据、不能任意 DDL/DML 的专用数据库 role。parameter binding 不能替代 identifier quoting。
- **依赖/关联**：RT-003（匿名用户可大量创建监听连接）；RT-004（项目 anon key 可收到启用表的完整行内容）。
- **验证方式**：Mock 测试确保恶意表名在创建 Client 前被拒绝；隔离 PostgreSQL/Neon 测试带分号负载无法执行附加语句；用专用 role 验证对其他 schema 的 SELECT/DDL/DML 均被 DB 拒绝。

## [RT-002] 数据库连接错误和初始化失败未统一关闭/恢复 channel

- **优先级**：P1
- **置信度**：已确认（驱动 error/close 后底层 socket 是否自动关闭还需确认）
- **问题类型**：可用性 / 资源生命周期 / 异常处理
- **涉及文件**：`apps/api/src/realtime/realtime.service.ts:44-129`、`apps/api/src/realtime/gateways/realtime.gateway.ts:85-93`
- **调用链**：`handleSubscribe()` await `subscribe()` → Client 创建、connect、注册 notification handler、LISTEN → map 写入；断开走 Client `error` handler 或 Gateway `handleDisconnect()` → `unsubscribe()`。
- **触发条件与最小复现**：分别让 connect 失败、LISTEN query 失败、成功后断开 DB WebSocket；观察 Client `end/close`、Map、房间和后续事件。
- **问题描述**：Client 只有 error handler；connect/LISTEN 失败路径没有 `try/finally` 调 `end()`。error handler 只删除当前 map 项，不重建 listener、不通知 Gateway，也不显式关闭 client。没有 close/end 状态处理。连接可用后若 error 使 map 删除，Gateway 的 `socketCallbacks` 和 Socket.IO room 仍保留；同一 socket 再订阅时会因本地去重直接 return，不能恢复。
- **根因分析**：channel 生命周期实际分散在三份状态：RealtimeService `listeners`、Gateway 每 socket `socketCallbacks`、Socket.IO room。只有成功执行 LISTEN 后 Service 才 set Map；断线仅修改其中一份。subscribe 失败向 Nest handler reject，Gateway 没有错误确认事件或状态回滚。
- **已确认事实**：未发现重连/退避代码；`error` handler只删 map；未发现 `close/end` listener；首次连接/LISTEN 失败没有显式 end；room 加入早于 DB subscribe，失败时不会 leave；UI 对服务器 subscribe 错误没有匹配的确认处理。
- **运行时待验证**：Neon Client 1.1.0 底层 WebSocket error 后是否总会自动关闭以及 `end()` 在半连接时的行为，需驱动/真实网络测试；无论底层是否自关，map/room/callback 的恢复不一致仍成立。
- **影响范围**：单个 channel 静默停止推送、失败连接残留、UI 显示 Listening 但实际上未监听；依断线类型可能积累 DB 连接。
- **修复建议**：用单一 channel state machine 管理 connecting/ready/retrying/closing/closed；所有异步初始化失败关闭 client 并回滚 room/本地状态；运行中 error/close 进入有上限退避的恢复流程，成功后恢复 LISTEN 并维护 callback 集合；失败通过 Socket.IO ACK/事件通知客户端。
- **依赖/关联**：RT-006 处理初始化并发及断开/退订竞态；RT-007 处理重连期间不可避免的通知缺口。
- **验证方式**：fake Client 对 connect、LISTEN、error、close、UNLISTEN、end 按序失败注入；断言不存在孤儿 client/map/room，UI 能确认订阅失败或恢复。

## [RT-003] 每个未限制的 channel 都创建一条长连接，可耗尽数据库连接

- **优先级**：P1
- **置信度**：已确认
- **问题类型**：资源耗尽 / 可扩展性 / 拒绝服务
- **涉及文件**：`apps/api/src/realtime/gateways/realtime.gateway.ts:97-129`、`apps/api/src/realtime/realtime.service.ts:44-99`
- **触发条件与最小复现**：通过公开 anonKey 建立一个 Socket，连续订阅多个不同的简单字符串（无需对应真实表）；每个成功 LISTEN 的 channel 观察一条新 DB session。
- **问题描述**：`listeners` 以 channel 为键，首次订阅每个新 channel 都 new 一个 `Client` 并保持连接；Gateway 不限每 socket/每 project 的订阅数、不校验真实表，也没有全局 channel 上限。PostgreSQL LISTEN 允许监听一个尚未通知的合法 channel，因此随机表名仍可占用 Client。
- **根因分析**：连接粒度选择为每 `(projectId, tableName)` 一个 Client，而公开 anon key 可建连且订阅入口不限流；表名校验缺失还允许攻击面扩展。清理只依赖客户端主动退订/断开，断线清理本身又受 RT-002/006 竞态影响。
- **影响范围**：攻击者能够消耗 Neon/数据库连接额度、WebSocket 和 Node 内存，使正常 API/Realtime 无法建连。若攻击者并发创建 socket，还会叠加每 socket 的 Map/回调资源。
- **修复建议**：先校验并限制到确实启用的表；设置每项目、每 socket 订阅数和连接数上限、握手/消息速率限制与空闲超时。优先评估每进程共享一条 Listener Client 同时 LISTEN 多 channel（单连接可执行多条 LISTEN）；若采用共享连接，集中串行化 LISTEN/UNLISTEN，并做好单连接故障时全部 channel 恢复。必须监控连接额度并拒绝超限订阅。
- **依赖/关联**：RT-001 允许更复杂 SQL 输入；RT-002/006 的泄漏和重复连接会放大资源风险。
- **验证方式**：并发订阅超过阈值应收到明确拒绝且连接数受限；退订/断开后连接回落；压力测试观察连接数和内存有固定上界。

## [RT-004] 任意启用表的完整行内容会广播给只持有 anon key 的客户端

- **优先级**：P2（需产品明确表级公开语义）
- **置信度**：源码行为已确认；是否违背业务期望待确认
- **问题类型**：数据隔离 / 字段级授权
- **涉及文件**：`apps/api/src/realtime/gateways/realtime.gateway.ts:53-79,97-129`、`apps/api/src/realtime/trigger.service.ts:36-68`、`apps/web/src/features/realtime/realtime-client.tsx:61-63`
- **调用链**：平台签发长效 anon key → 前端将 anonKey 放入 Socket.IO handshake → Gateway 只验签和 role 是否为两种常量之一 → 任意客户端提交表名 → LISTEN 仅由 projectId/tableName 限定 → trigger 发送 `row_to_json(NEW/OLD)` 全字段 → room 广播完整 event。
- **触发条件**：组织成员通过控制台为某表启用 trigger；任何持有项目 anonKey 的外部客户端即可订阅同项目同名 channel。
- **根因分析**：Gateway 校验 token 后只保存 projectId/role；role 后续没有用于订阅授权。没有从 projects/table policy 查表权限或列权限。Trigger payload 包含整行数据，UPDATE/DELETE 还包含 oldRecord。
- **影响范围**：启用 Realtime 的表会公开其所有列和被触发的每行值；含邮箱、内部状态或个人数据时可能构成敏感数据外泄。房间 projectId 前缀可隔离不同项目，但不提供项目内 ACL。
- **修复建议**：产品需明确“enable”是否等价公开发布。若是，UI/API 明确标注并禁止敏感表；若不是，维护表级订阅 ACL/认证用户 token，并在事件生成端做列白名单/最小字段投影。分别验证 anon 与 serviceRole 的权限差异，目前两者都能订阅。
- **依赖/关联**：和 project-api 的 anon 表暴露策略是平行通道；即使 REST 修好，此 WS 推送权限仍需单独限制。
- **验证方式**：用 anonKey 从非控制台客户端订阅敏感字段表，检查当前行为；修复后对未授权表和列得到拒绝/脱敏，对显式公开表仍可正常收到事件。

## [RT-005] 整行 JSON 超过 NOTIFY payload 限制会让业务写事务失败

- **优先级**：P2
- **置信度**：已确认（PostgreSQL 默认配置；若部署修改上游行为需验证）
- **问题类型**：业务可用性 / 数据库事务
- **涉及文件**：`apps/api/src/realtime/trigger.service.ts:36-68`
- **触发条件与最小复现**：启用 realtime 的表含较大 text/jsonb 字段；INSERT/UPDATE/DELETE 后 `row_to_json` 序列化 payload 达到或超过默认 8000 bytes。
- **问题描述**：行级触发器无条件把完整 NEW/OLD 行打包为 JSON，再调用 `pg_notify(channel, payload::text)`。PostgreSQL 文档规定默认 payload 必须短于 8000 bytes。该调用发生在写事务内，超限会令触发器语句失败并使业务 DML 回滚，而不是只丢实时事件。
- **根因分析**：NOTIFY 被用作承载完整数据的消息队列；没有字节长度上限、裁剪、按主键通知或失败隔离。JSON 字节长度也可能不同于字符数。
- **影响范围**：启用 realtime 的数据表中大行写入中断；批量语句任一行触发异常可能导致整条语句失败。
- **修复建议**：NOTIFY 只发送短小稳定标识（项目/表/主键/操作/版本），订阅者另行通过授权 API/DB 读取行；或显式裁剪字段并在超限时降级为 invalidation 事件。不要吞掉触发器错误后假装写成功。
- **来源/验证依据**：PostgreSQL `NOTIFY` 官方文档说明默认 payload 少于 8000 bytes，并说明通知属于事务语义：https://www.postgresql.org/docs/current/sql-notify.html
- **依赖/关联**：RT-004（完整行广播最小化）；RT-007（通知只做变更提示后需要重新读取状态）。
- **验证方式**：真实 PostgreSQL 测试在 7999、8000+ bytes 的边界写入，断言当前大 payload 会使 DML 报错；修复后大行写入成功且客户端收到可处理的 invalidation/key 事件。

## [RT-006] 并发首订阅及订阅期间断开会覆盖 Map 并遗留连接

- **优先级**：P1
- **置信度**：已确认（确定性可由 fake Client 延迟控制复现）
- **问题类型**：竞态 / 重复投递 / 资源泄漏
- **涉及文件**：`apps/api/src/realtime/realtime.service.ts:44-99`、`apps/api/src/realtime/gateways/realtime.gateway.ts:85-138,142-170`
- **触发条件与最小复现**：两个 handler 同时 subscribe 同一初始空 channel，并延迟两次 connect/LISTEN；或在 subscribe await 期间断开 socket/立即 unsubscribe。
- **根因分析一（channel 初始化）**：Service 在 await connect/LISTEN 结束之前从不将 `connecting` entry 写入 map。并发调用都看到不存在，于是建两个 Client；完成后两个 `set(channel, ...)` 后写者覆盖前写者。每个 Client 的 notification handler 又读取当前 Map 最新 entry，因此两个数据库连接都可调用同一最新 callback，造成重复转发；先完成的 Client 从未被保留/关闭。
- **根因分析二（Gateway 状态）**：Gateway 在 `client.join(room)` 后 await service，完成后才写 `socketCallbacks`。如果 disconnect/UNSUBSCRIBE 在 await 窗口发生，清理查不到 callback；service 后续完成仍保存订阅 callback，disconnect 已经错过清理，导致数据库连接与 gateway map 残留。unsubscribe 时先 leave room，但 subscribe 完成可在之后写入状态。
- **影响范围**：同 channel 重复连接和事件重复、被覆盖 Client 泄漏；断开或退订后仍留 Map/DB 连接；房间状态与 callback 记录不一致。
- **修复建议**：Map 存储 `Promise<ChannelEntry>`/connecting entry，先原子占位，同一 key 的并发 subscribe await 同一 promise；失败时删除占位并关闭 Client。Gateway 对 `(socketId, channel)` 使用 subscribing/subscribed/unsubscribing 状态及 operation token；await 完成后检查 socket 仍 connected 且订阅未取消，否则立即退订，不写入陈旧状态。channel callbacks 用 Set 做幂等引用计数。
- **依赖/关联**：RT-002 的生命周期状态机应覆盖此 race；RT-003 连接预算会被重复连接加剧。
- **验证方式**：用 deferred promises 精确控制两个 connect/LISTEN 完成顺序；断言每个 channel 只有一个 Client、每个事件只 emit 一次；subscribe 与 disconnect/unsubscribe 交错后 room、callback、listener 和 Client 均归零。

## [RT-007] LISTEN/NOTIFY 是瞬时通知，断线期间事件无补偿且客户端界面乐观显示成功

- **优先级**：P2
- **置信度**：已确认
- **问题类型**：事件投递语义 / UI 与服务状态一致性
- **涉及文件**：`apps/api/src/realtime/realtime.service.ts:80-99`、`apps/api/src/realtime/gateways/realtime.gateway.ts:96-138`、`apps/web/src/features/realtime/realtime-client.tsx:69-88,105-135`
- **触发条件**：任意监听 DB Client/Socket.IO 断线期间发生写入，或者订阅事件失败。
- **问题描述**：PostgreSQL NOTIFY 无持久回放；Service 只在 notification 到达时向在线 room emit，没有事件 ID/offset/ACK/replay。前端重连只重发订阅，不补拉断线期间数据（组件自身 TODO 已注明）。初次 subscribe 与退订使用 `socket.emit` 无 ACK；开关在 server 确认 LISTEN 成功前就显示 Listening。
- **根因分析**：把实时通知同时当作状态变更日志和订阅成功信号，但系统没有持久事件表/同步游标；协议没有订阅结果 ACK。DB 错误时 UI 本地状态可能与服务端实际状态分歧。
- **影响范围**：事件 feed 可有缺口；调用方若把这些事件当审计日志、精确 CDC 或唯一状态源会数据不一致；UI 错误显示监听成功。
- **修复建议**：明确定义 best-effort invalidation 语义；连接/重连后通过普通 API 重新读取当前状态。若必须零丢失，写事务同时记录 outbox/事件表并以 sequence/cursor 拉取。为 subscribe/unsubscribe 增加 ACK 和错误应答，前端确认后再更新开关。
- **来源/验证依据**：PostgreSQL LISTEN/NOTIFY 官方文档说明通知在事务提交后交付且只在已 LISTEN 的会话收到，不提供历史回放：https://www.postgresql.org/docs/current/sql-listen.html 与 https://www.postgresql.org/docs/current/sql-notify.html
- **依赖/关联**：RT-002 断线恢复；RT-005 将推送改成主键/invalidation 后必须有读取接口。
- **验证方式**：在 DB 断线及 socket 断线期间写数据，再重连；确认当前行为会漏掉实时消息但 API 可重新同步；修复后 ACK 错误可见，重连同步结果正确。

## [RT-008] PostgreSQL 函数名截断会让长表名共用通知函数并串错 channel

- **优先级**：P2
- **置信度**：已确认（依赖 PostgreSQL 默认 63-byte identifier 限制；可用真实数据库稳定复现）
- **问题类型**：事件路由正确性 / 项目内数据隔离
- **涉及文件**：`apps/api/src/realtime/trigger.service.ts:19-34,78-90`、`apps/api/src/table-editor/table-editor.service.ts` 的 `createTable()`
- **触发条件与最小复现**：在同一项目 schema 创建两个 ASCII 表名，前 56 字符相同但后缀不同；依次分别调用 enable。
- **问题描述**：`enableRealtime()` 以 `${tableName}_notify` 生成 PostgreSQL 函数标识符。tableName 可达 PostgreSQL 默认允许的 63 bytes，而 `_notify` 再增加 7 bytes。PostgreSQL 默认 `NAMEDATALEN=64`，标识符只保留 63 bytes，长名被静默截断。相同前 56 字符的两个表会生成同一个实际函数名。
- **根因分析**：`assertSafeIdentifier()` 只校验字符集，没有对“加后缀后的函数名”检查长度或生成唯一内部名。第二张表的 `CREATE OR REPLACE FUNCTION` 会替换同 schema 下第一张表触发器引用的同名零参数函数；函数体内 channel 是创建时硬编码的第二张表 channel。
- **影响范围**：第一张表变化会通过第二张表 channel 推送，event 内 `table` 仍是第一张表名、record 含第一张表数据。订阅第二张表的客户端因此收到另一张表的数据；反向事件也无法按预期路由。
- **验证依据**：PostgreSQL 官方 lexical structure 文档说明默认最大标识符长度是 63 bytes：https://www.postgresql.org/docs/current/sql-syntax-lexical.html。代码中的 `fnName` 后缀与 `CREATE OR REPLACE FUNCTION` 使用已确认。
- **修复建议**：函数名不要从未经长度预算的表名加后缀得到。使用基于 projectId/table identity 的固定长度 hash 内部名，或明确检查表名允许长度小于 `63 - suffix byte length`；建立并维护 table→function 映射，enable/disable 用同一映射。
- **依赖/关联**：RT-004 同属项目内表隔离；RT-005 是 trigger payload/写事务可靠性。
- **验证方式**：PostgreSQL 集成测试创建两个共享前缀长名的表，分别 enable 并分别写入；各 channel 只能收到对应 `TG_TABLE_NAME` 的事件，函数目录中函数名唯一。

