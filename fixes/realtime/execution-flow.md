# Realtime 执行流程（当前源码）

本图描述仓库当前实现，不代表建议改造后的状态。所有路径均相对仓库根目录。

## 连接认证、订阅与通知

```mermaid
sequenceDiagram
    autonumber
    participant Web as RealtimeClient<br/>apps/web/src/features/realtime/realtime-client.tsx
    participant GW as RealtimeGateway<br/>apps/api/src/realtime/gateways/realtime.gateway.ts
    participant JWT as JwtService + ConfigService
    participant RS as RealtimeService<br/>apps/api/src/realtime/realtime.service.ts
    participant PG as PostgreSQL/Neon
    participant TR as TriggerService<br/>apps/api/src/realtime/trigger.service.ts
    participant Room as Socket.IO table room

    Web->>GW: io('/realtime', auth.token=anonKey)
    GW->>JWT: handleConnection(): verify(PROJECT_JWT_SECRET)
    JWT-->>GW: projectId, role
    GW->>GW: role 必须为 anon 或 service_role
    GW->>GW: client.data 写 projectId/role
    GW->>GW: join project:{projectId}
    Note over GW: 当前 role 之后未参与订阅授权

    Web->>GW: emit subscribe(tableName)
    GW->>GW: trim + 每 socket callback 去重
    Note over GW: 无类型/identifier/表存在/ACL/限额校验
    GW->>Room: join project:{id}:table:{tableName}
    GW->>RS: subscribe(projectId, tableName, callback)
    RS->>PG: new Client(REALTIME_DATABASE_URL ?? DATABASE_URL)
    RS->>PG: connect() WebSocket
    RS->>PG: query('LISTEN ' + channel)
    PG-->>RS: LISTEN 完成
    RS->>RS: listeners.set(channel, {client, callbacks})
    RS-->>GW: subscribe resolved
    GW->>GW: socketCallbacks.set(socketId, entry)
    GW-->>Web: 当前无显式订阅 ACK

    Note over PG,TR: 管理端 HTTP enable 另一路：RealtimeController 的 JwtAuthGuard + OrgRoleGuard → getProject(orgSlug, projectSlug) → TriggerService.enableRealtime(schema,id,table) 创建函数/触发器
    PG->>TR: row INSERT/UPDATE/DELETE 执行 trigger
    TR->>PG: row_to_json(NEW/OLD) → pg_notify(channel,payload)
    Note over PG: NOTIFY 在写事务提交后交付；当前 payload 是完整行
    PG-->>RS: Neon Client 'notification'
    RS->>RS: JSON.parse(payload)；从当前 channel Map 取 callbacks
    RS->>Room: callback 用 server.to(table room).emit('event', event)
    Room-->>Web: 收到 event
```

实际入口/方法：

- 浏览器连接及重连：`apps/web/src/features/realtime/realtime-client.tsx` 的 `io()`、`socket.on('connect')`。
- 握手认证：`apps/api/src/realtime/gateways/realtime.gateway.ts` 的 `handleConnection()`；项目 key 在 `apps/api/src/projects/projects.service.ts:32-40` 签发，期限 100 年。
- 订阅/退订：同 Gateway 的 `handleSubscribe()`、`handleUnsubscribe()`。
- DB 连接选择及 LISTEN：`apps/api/src/realtime/realtime.service.ts` 的 `getListenConnectionString()`、`subscribe()`。
- 触发器开关：`apps/api/src/realtime/realtime.controller.ts`；数据库 DDL/NOTIFY 在 `apps/api/src/realtime/trigger.service.ts`。

## 退订、断开和数据库错误：当前行为

```mermaid
sequenceDiagram
    participant Web as realtime-client.tsx
    participant GW as RealtimeGateway
    participant RS as RealtimeService
    participant PG as Neon Client/PG

    Web->>GW: emit unsubscribe(table)
    GW->>GW: client.leave(table room)
    GW->>GW: 从 socketCallbacks 查 callback
    GW->>RS: unsubscribe(projectId, table, callback)
    RS->>RS: Set.delete(callback)
    alt channel callbacks 变空
      RS->>PG: query('UNLISTEN ' + channel)
      RS->>RS: 立即 listeners.delete(channel)
      RS->>PG: finally client.end()
    else 仍有订阅者
      Note over RS: 保留当前 Client 与其他 callback
    end

    PG--xRS: error
    RS->>RS: 仅当 Map 项指向该 client 时 delete Map
    Note over RS,GW: 没有重连；Gateway room/callback 去重状态不变

    Web--xGW: Socket.IO disconnect
    GW->>RS: 对已记录 callbacks 逐一 unsubscribe
    GW->>GW: delete socketCallbacks(socketId)
    Note over GW,RS: 若 subscribe 尚在 await，callback 尚未登记，disconnect 会错过它
```

正常共享语义：已有 channel 在 Map 中时，后续订阅把 callback 加进 `Set`，一个 PG 通知触发 callbacks；一个客户端正常退订只删自己的 callback，只有 callbacks 归零才发 UNLISTEN/关闭 DB Client。

当前故障语义：

- connect/LISTEN 失败时没有可靠的 room rollback/client close。
- 连接 error 时删 service Map，但没有重新 LISTEN；Gateway 的本地去重仍将该 socket 视为已订阅。
- 首次订阅被并发调用时，Map 尚无 connecting entry，会重复建 Client。
- Socket.IO 房间移除和数据库 listener 生命周期不是一个原子操作。
- 浏览器重连会重发本地 subscribedRef 中的表名，但当前 DB Client 断线本身不触发浏览器 socket 重连，也没有 event replay。

## 当前状态图

```mermaid
stateDiagram-v2
    state "RealtimeService channel Map" as Channel {
      [*] --> Absent
      Absent --> Connecting: subscribe 创建 Client（但此状态未写入 Map）
      Connecting --> Ready: connect + LISTEN 成功后 set Map
      Connecting --> Absent: connect/LISTEN reject（未保证 end）
      Ready --> Ready: 新 callback 加入 Set
      Ready --> Absent: error handler 删除 Map（无恢复）
      Ready --> Closing: 最后 callback 删除后发 UNLISTEN
      Closing --> Absent: Map 先删，finally end
    }

    state "Gateway per-socket 状态" as SocketState {
      [*] --> NoEntry
      NoEntry --> RoomJoined: subscribe 先 join room
      RoomJoined --> Recorded: service Promise 完成后记录 callback
      RoomJoined --> NoEntry: 失败时源码没有显式回滚
      Recorded --> Recorded: duplicate subscribe 直接 return
      Recorded --> NoEntry: unsubscribe/disconnect 清记录
      RoomJoined --> Disconnected: await 期间断开
      Disconnected --> Recorded: subscribe Promise 之后完成，可能留下陈旧 entry
    }
```

> `Connecting/Closing` 是为了表达实际 await/操作窗口的分析标签；源码的 `listeners` Map 只有 `{client, callbacks}`，没有状态字段，也没有在 connect 前占位。

## 修复目标图（建议状态，不是当前行为）

目标方案应以一个带 `state + generation + ready Promise + callbacks` 的 channel entry 为唯一事实源。先原子占位后初始化；所有失败路径 close；最后订阅退订后再结束 Client；socket 的 pending 操作携带取消标记；重连 READY 后 ACK 客户端。详情见 `recommendations.md` 和 `reliability-analysis.md`。
