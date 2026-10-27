# Realtime

Novabase Realtime 在 Socket.IO 上推送项目数据库表的 `INSERT`、`UPDATE`、`DELETE` 变更元数据。变更触发器不广播 `NEW`/`OLD` 行内容，`record` 固定为 `null`。

## 投递语义

- 项目管理员启用表时，Realtime 在该项目 schema 创建 `_rt_outbox` 和 `_rt_outbox_state`，并创建表级触发器。
- 每次 DML 与 outbox 元数据事件写入同一个 PostgreSQL 事务。事件有 `seq: string` 游标（PostgreSQL bigint 十进制字符串），同时通过 `pg_notify` 发出实时提示。
- 服务端每个表维护 LISTEN 连接。订阅时先建立/复用 LISTEN，再按 `since` 从 outbox 升序补投、加入 Socket.IO 表房间并做第二次查询以关闭订阅竞态。
- 客户端按表保存游标；实时事件先按 `seq` 去重。服务端补投与 live notification 有交叠时可能重复，消费方仍应按 `seq` 幂等处理。
- 默认保留 24 小时，清理每 10 分钟运行，每项目 schema 每轮最多处理 10 个 1000 行批次。`REALTIME_OUTBOX_RETENTION_HOURS` 可调整保留时间；`REALTIME_MAX_REPLAY_ROWS` 默认 500，硬上限 1000。
- 若 cursor 早于该表已清理的水位，或缺口超过补投上限，subscribe ACK 返回 `gap: 'expired'` 和当前 cursor。管理端执行快照对齐；SDK 通过 `onError` 报告 `CURSOR_EXPIRED`，由应用查询快照。
- 至少一次投递只适用于客户端仍持有 last cursor 且事件仍在保留范围内；它不是 exactly-once。Web/SDK 内存 cursor 在页面/进程重启后丢失，应用需持久化已成功处理的 `event.seq` 并通过 `since` 恢复。

补投的是操作元数据，不是历史行镜像。快照可以对齐当前状态，但无法重建断线期间后来又被更新/删除的中间状态。未启用 Realtime 的表不会产生 outbox 事件。

## 前端控制台

- 打开项目 Realtime 页面后使用项目 anon key 建立 `/realtime` Socket.IO 连接。
- 启用表使用管理端 API（cookie/JWT/组织权限）；订阅使用 Socket.IO ACK。
- 首次订阅成功、Socket 重连、数据库 listener 恢复或 ACK 报告过期/补投后，控制台通过项目 REST API 读取最多 1000 行当前快照；可手动刷新。超过 1000 行的表只读取部分数据。
- 控制台事件 feed 展示带 `seq` 的变更元数据，快照用来对齐最新状态，不替代逐条事件历史。

## API 与 Socket 协议

启用和禁用仍是管理端接口：

```http
POST   /api/orgs/:slug/projects/:projectSlug/realtime/:tableName/enable
DELETE /api/orgs/:slug/projects/:projectSlug/realtime/:tableName/disable
```

Socket.IO namespace 为 `/realtime`，握手使用 `auth: { token: anonKey }`。订阅支持新旧载荷：

```ts
socket.emit('subscribe', { table: 'posts', since: '42' }, (ack) => {});
socket.emit('subscribe', 'posts', (ack) => {}); // 兼容旧客户端，不带 cursor
```

订阅成功 ACK：

```ts
{ ok: true, cursor: '50', gap: 'replayed', replayed: 8 }
```

`gap` 为 `none`、`replayed` 或 `expired`。事件至少包含：

```ts
{
  version: 1,
  seq: '50',
  type: 'UPDATE',
  table: 'posts',
  record: null,
  projectId: '…',
  timestamp: '…'
}
```

无 `since` 的新订阅从订阅开始时建立 baseline，不会默认回放整段保留历史。非法或超前 cursor 返回失败 ACK。`_rt_` 前缀保留给内部表；它们从 Table Editor/API 文档/Realtime 表清单过滤，并禁止通过项目 REST API 直接访问。

## SDK

旧用法仍兼容：

```ts
novabase.realtime.subscribe('posts', onEvent, onError);
```

可在第三个参数传入 `since` 和 `onError`：

```ts
novabase.realtime.subscribe('posts', onEvent, {
  since: savedCursor,
  onError: (error) => {
    if (error.code === 'CURSOR_EXPIRED') void reloadSnapshot();
  },
});
```

SDK 自动维护当前实例中的 per-table cursor，并在 Socket 重连时携带 `since`。如果应用需跨刷新恢复，应在成功处理 event 后持久化 `seq`；SDK 自身不访问 REST，也不会替应用执行快照查询。

## PostgreSQL、保留和部署

同表触发器使用 `pg_advisory_xact_lock`，串行化 identity seq 分配与该表事务提交顺序。这样客户端水位推进不会越过一个更早提交的同表事件；代价是同表写事务在 trigger 段会串行化，写密集表应在隔离环境压测。

每表 `_rt_outbox_state` 记录 `latest_seq` 和 `expired_through_seq`。outbox DELETE trigger 在清理或手工删除时同步推进删除水位，避免全局 identity 中其他表/回滚产生的正常 seq 空洞被误判为过期。清理使用单条 SQL 中的 `pg_try_advisory_xact_lock` 和有界 DELETE，兼容当前 Neon HTTP Drizzle provider，且多实例同一批次只有一个实例能持锁。

Outbox DDL 在管理端 enable 时创建，不添加 Drizzle migration。已存在的 Realtime 表需在升级后再次执行 enable，以创建 outbox/state 表并替换原触发器；未迁移的旧 trigger 不带 seq，新的 listener 无法将其作为游标事件处理。部署时逐表重新启用并验证后再确认升级完成。

清理只删除过期事件，不删除共享 outbox/state 表；禁用单表 Realtime 只删该表的 trigger。删除状态表或绕过其 DELETE trigger 手动 `TRUNCATE` 会破坏过期水位，不应作为日常清理方式。
