# Realtime 可靠性与连接生命周期分析

## 状态所有权与实际资源粒度

| 对象 | 当前存储位置 | 生命周期/关键缺陷 |
|---|---|---|
| 项目 key 身份 | `RealtimeSocket.data.projectId/role` | 连接时写入；没有撤销/过期中动态重校验。项目 key 有效期 100 年。 |
| Socket.IO table room | Socket.IO Adapter 的 room membership | subscribe 先 join；成功 DB subscribe 之前就加入。失败不显式 leave；disconnect 时 Socket.IO 会移除房间，但服务 Map 可能遗留。 |
| socket→callback | Gateway `socketCallbacks: Map<socketId, SocketCallbackEntry[]>` | 仅 DB subscribe resolve 后记录；重复通过 array some 判定；pending subscribe 不可取消。disconnect 只清已记录 entries。 |
| channel→DB Client | RealtimeService `listeners: Map<channel,{client,callbacks:Set}>` | 首次 LISTEN 完成后才 set；connecting 状态不可见；一个逻辑 channel 一个 Client；error 只删 Map。 |
| DB listener | Neon `Client` + PostgreSQL session | `connect()` 一条直连 WebSocket；执行 LISTEN 后长期持有。最后 callback 时 query UNLISTEN 后 end。无自动重试。 |
| trigger | 项目 schema 函数 + row trigger | HTTP enable 逐条执行 CREATE FUNCTION / DROP TRIGGER / CREATE TRIGGER；disable 仅 DROP TRIGGER，函数保留。DDL 无显式事务封装。 |
| event | PG notification → JSON → server emitter → Socket.IO | 无 event id/sequence/ACK/persistence。失联期间不会 replay。 |

## 并发时序审计

### 两个客户端同时订阅首次 channel（RT-006）

1. 请求 A、B 都在 `listeners.get(channel)` 得到 undefined。
2. 两边分别 new Client；两边 connect 和 LISTEN 都可成功，因为 `listeners.set` 尚未发生。
3. A set entryA，B set entryB 覆盖 entryA；entryA client 没有任何可达清理引用。
4. 两个 Client 都收到同一 PG channel 通知；notification handler 每次重新读取 Map 当前 entryB，因此都调用 entryB callbacks。
5. 同一个 room/event 可能由 A、B 双重 emit。被覆盖 Client 的 error handler因 `Map.get(channel).client !== client` 而不清理 Map；仍无 close/end handler。

### subscribe 与断开/退订交错（RT-006）

1. Gateway 先 `join(room)`，调用 Service 并 await connect/LISTEN。
2. 该 await 期间 disconnect 触发 `handleDisconnect()`，但 `socketCallbacks` 还没记录 callback，故没有调用 unsubscribe。
3. subscribe Promise 之后完成，仍执行 `socketCallbacks.set()`；断开后的 socket room 虽已被 adapter 清理，callback 和 DB Client 仍被 service map 持有。
4. 若是 unsubscribe 交错，UNSUBSCRIBE 先 leave room，因 callback 尚未登记而找不到 entry；原 subscribe 完成后又写回 callback，形成后台监听/陈旧记录。

### Service error 与 Gateway 状态分裂（RT-002）

- error handler从 `listeners` 删除当前项；它不清理对应 callbacks、不关闭 client、不令 Gateway 删除 socket entry，也不触发 retry。
- 同 socket 再发相同 subscribe 时 `socketCallbacks.some()` 返回 true，Gateway 提前 return，不会调用 service 重建 LISTEN。
- 若客户端 socket 自己断线重连，前端会根据 subscribedRef 重发；但 DB Client error 不必然造成 Socket.IO 断线，两条连接没有联动。

### 退订与清理细节

- callback Set 可以正确避免同一 function 重复加入，并让多个正常客户端共享一个现存 channel client；单客户端正常退订只删自身 callback，不影响其他 callback。
- 最后一位退订时先异步 query UNLISTEN，立即删 Map，再在 finally end。新的 subscribe 可同时创建另一个 Client；旧 query/end 不校验 map generation。连接资源最终是否安全取决于 Neon Client 对并发 query/end 的行为。
- `void query().finally(...)` 会生成一个新的 Promise；若 UNLISTEN reject，finally 执行后 Promise 仍 reject，但调用方没有 catch，存在 unhandled rejection 风险。`void end()` 同样未观察 rejection。
- `onModuleDestroy()` 只关闭当前 Map 可见 Client；未收录的 in-flight Client、并发 subscribe 已覆盖 Client不在列表中。任一 `end()` reject 会使 `Promise.all` reject，`listeners.clear()` 不再执行。
- source 没有 `close/end` listener，没有将连接状态对外暴露的指标，也没有重连退避。

## PostgreSQL 事件投递语义

- trigger 是 `FOR EACH ROW`，所以一条批量 DML 会为每行调用 PL/pgSQL 函数。
- `pg_notify` 在事务提交后才投递；事务 rollback 时通知也不投递。通知不是持久日志，未在线 LISTEN 的消费者不会之后补收。
- PostgreSQL 会在单个事务内折叠相同 channel + 相同 payload 的重复通知。Trigger payload 中 `now()` 是事务时间；同一行在一个事务中重复执行相同变更且 NEW/OLD image 相同可能生成完全相同 payload，因此并非严格 one-event-per-row。
- payload 默认必须小于 8000 bytes；当前全行 JSON 无上限，超限让触发器失败并使 DML 事务失败。
- `RealtimeService` 没有对 notification sequence 做持久记录；`RealtimeClient` reconnect handler 只重订阅，未 snapshot/catch-up（源码注释明确写“只有订阅关系补偿，没有订阅数据补偿”）。
- `Socket.IO` 连接使用 `transports: ['websocket','polling']`，Gateway 使用默认 Socket.IO Server/Adapter，没有显式跨进程 adapter。当前每个 API 进程自己的 DB listener 向本进程 room 广播，单实例行为成立；多实例部署仍应确认 LB 对 polling 的 sticky-session 配置与进程优雅退出。没有证据表明当前部署已启用多实例，故不作为已确认缺陷。

## 性能与容量

- 正常每个活跃 `(projectId, tableName)` 在每个 API 进程保有一个 Neon Client/DB session；有 N 个活跃 channel 就至少有 N 条 listener connection。不是每 socket 一条，但不同 channel 不共享连接。
- Gateway/Service 没有订阅数量和速率限制；一次 socket 可创建任意多个合法 channel。公开 anonKey 增加资源攻击可达性。
- 每个 row event callback 在 room 内广播；Socket.IO 按 room 遍历接收者。服务没有 payload 限制（除 PG NOTIFY 上限）、慢客户端队列监控或事件批量策略；实际 Socket.IO transport buffer 上限行为需结合运行时 Engine.IO 配置验证。
- 当前前端仅保留最近 100 条展示事件，降低 browser state 增长；这不限制服务端连接/广播资源。

## 建议目标状态

1. 一个 channel entry 是唯一状态权威，包含 `state/generation/readyPromise/client/callbacks/refCount/retryTimer`。
2. Service Map 在 await 前占位；同 key 初始化 single-flight；旧 generation 回调无权清理新 entry。
3. Gateway 在 pending 操作登记取消 token；subscribe ack 表示 DB 已 ready；disconnect 会撤销 pending 与 ready 两类引用。
4. 统一 connection budget：共享 client 或受限每表 client，并有指标、限额、退避和 shutdown drain。
5. 把通知定义为 invalidate/event-log 两种明确产品语义之一。需要可靠回放则 outbox；需要轻量实时 UI 则通知主键并重新读取快照。
