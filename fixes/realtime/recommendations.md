# Realtime 深度审查修复建议

> 以下为修复前方案记录；已落地项和未完成的部署/产品验证见 `README.md` 修复实施状态。实现过程中根据当前模块做了有限调整，不能把示例伪代码当作实际实现。

建议先做 RT-001、RT-003 的安全边界，再做 RT-006/RT-002 的生命周期和并发，之后调整事件协议（RT-005/RT-007）与表/列授权（RT-004）。改协议前先确认 Realtime 的产品语义是公开广播还是仅控制台观察。

## RT-001：阻断 WebSocket -> SQL 注入

**推荐方案**

1. 新增一个可单测的订阅解析器：只接受 `^[a-zA-Z_][a-zA-Z0-9_]*$`、长度不超过产品/PG 规则的 table identifier；非字符串、数组、对象、空白和控制字符一律 400/拒绝。不要将 `String(payload)` 转换成合法输入。
2. `RealtimeGateway.handleSubscribe()` 在 `join()` 和创建 DB client 之前调用校验，并把已规范化的 `projectId/tableName` 传给服务。
3. 通过 `projects.id + dbSchema + information_schema` 检查该表存在且 realtime enabled；若需要动态 channel，使用内部 channel id 或 `quoteIdentifier()` 生成受控 SQL 标识符。SQL 参数不能绑定 identifier，不能用参数绑定的错觉代替 quoting。
4. `RealtimeService` 不再接受原始字符串拼 SQL。集中实现 `buildListenSql(channel)`，并对 `UNLISTEN` 使用完全相同的编码规则。
5. 配置独立 `REALTIME_DATABASE_URL` 为只具备必要 schema/table 访问的 DB role；数据库权限作为第二道边界，不能代替应用输入校验。

**替代方案**：PostgreSQL `SELECT pg_listening_channels()` 不可作为安全隔离。可固定一个项目级 channel（低连接数但需在 payload 中可靠过滤 table）、每项目一个连接多 LISTEN（需 serial queue）或每表 channel（现模式简单但连接成本高）。

**涉及范围**：`RealtimeGateway.handleSubscribe/handleUnsubscribe`、`RealtimeService.subscribe/unsubscribe`、`TriggerService.channelName`、project/table 元数据查询与部署密钥。

**回归风险/验收**：合法现有 table names 仍能 LISTEN/UNLISTEN；注入 payload 在任何 SQL/房间 join 前拒绝；数据库角色无法读写无关 schema。不要用可执行破坏语句的生产凭据做安全测试。

## RT-002：统一 channel 连接状态机和失败恢复

**推荐状态数据结构**

```ts
type ChannelState = 'connecting' | 'ready' | 'retrying' | 'closing' | 'closed';
type ChannelEntry = {
  state: ChannelState;
  client?: Client;
  callbacks: Set<NotifyCallback>;
  ready: Promise<void>;
  generation: number;
  retryTimer?: NodeJS.Timeout;
};
```

Map 保留每个逻辑 channel 的同一个 entry；不要在 error 时直接删掉仍被 Gateway 引用的 entry。`subscribe` 在 READY 前为 callback 建立引用，订阅者共享 entry.ready；初始化失败删除对应 generation 并释放半开 client。error/close 统一进入状态迁移；重连 timer 只允许一个，采用有上限的指数退避与 jitter；close/dispose 时取消 timer。

```ts
async function initialize(entry: ChannelEntry, channel: string) {
  const client = createClient();
  entry.client = client;
  attachErrorAndCloseHandlers(client, entry);
  try {
    await client.connect();
    attachNotificationHandler(client, entry);
    await client.query(buildListenSql(channel));
    if (entry.state === 'closing' || entry.callbacks.size === 0) {
      await closeClient(client);
      return;
    }
    entry.state = 'ready';
  } catch (error) {
    await closeClient(client).catch(logCleanupFailure);
    throw error;
  }
}
```

示例是状态设计草图，不是现有源码或可直接粘贴的完整实现。事件监听器需按 Neon Client 1.1.0 实际 `error/end` 语义确认，避免重复关闭和 error listener 移除顺序问题。

**关闭策略**：最后 callback 退订时先标记 closing 并从 Map 用 entry identity 移除，阻止新用户加入；串行 await UNLISTEN，finally close Client。UNLISTEN 失败也必须 close。所有 query/end rejection 均被 catch 并打带 channel id 的结构化日志。`onModuleDestroy` 停止新订阅、取消 timers、对所有 current/in-flight Client 执行 allSettled close，再清 Map。

**涉及范围**：`RealtimeService` 生命周期；Gateway disconnect 和 Subscribe exception 流程；模块销毁。

**替代方案**：出错后主动通知客户端重新建 Socket，而不是服务端自动恢复，复杂度较低但会有更长停机和订阅竞态；需显式向 UI 呈现重连。

**验收**：单个 DB 断线不产生未捕获 rejection；订阅状态最终 READY 或明确失败；每次连接最多一个重试 timer；没有不可达 client 泄漏。

## RT-003：给订阅面和数据库连接设硬预算

先修 table validation/存在性检查，再实施配额，否则随机 channel 会绕开“表名数量有限”的假设。

- 明确连接策略：推荐每进程一个 LISTEN Client 监听多个安全 channel，或每个项目一个连接。建立 channel→callbacks 的逻辑引用计数。串行队列处理该连接上的 LISTEN/UNLISTEN，确保连接初始化与 concurrent command 顺序确定。
- 设置 `maxChannelsPerProject`、`maxSubscriptionsPerSocket`、全局 DB listener 上限；超限返回 Socket.IO ACK `{ok:false, code:'LIMIT_EXCEEDED'}`。限制新连接/IP/项目的握手速率和订阅消息频率，且设置最大 socket 数与空闲断开策略。
- 连接限额以配置显式小于 DB 可用连接预算，并预留 API/迁移/管理连接；监控当前 active channels、clients、listeners 和拒绝计数。
- 客户端退订/断开按引用计数递减；只有最后一个 callback 移除数据库 LISTEN。单个用户离开不能关闭共享 channel 上其他用户的订阅。

**替代方案**：保持一 channel 一连接并增加较低硬限制，改动小但连接扩展性弱；若预期每项目只订阅少量表，可作为短期缓解。

**验收**：匿名 key 超限时数据库 client 数不再增加；正常并发连接互不影响；压测后连接数、Map 数量都回到基线。

## RT-004：明确定义 Realtime 表/字段公开策略

- 产品确认 enable action 是公开发布开关还是仅开启 CDC。若仅公开部分表，在 DB 保存项目级 realtime allowlist；不能靠“表名难猜”保护。
- Gateway 将 token role 带到订阅授权；匿名 anon key 只能订阅公开表，authenticated user token 还需验证签名、projectId 和用户权限。当前没有终端用户 JWT 到 Socket 的校验路径，不要把 `project-auth` token 默认为已受信。
- 变更事件只发允许的字段投影。更新/删除的 oldRecord 同样套投影，避免只脱敏新记录而泄露旧值。
- 设计 SQL RLS 时核实通知触发器函数以什么 owner/SECURITY DEFINER 身份运行。当前函数默认未写 `SECURITY DEFINER`；不要在没有权限测试时假定 RLS 自动保护广播。

**验收**：角色×表×字段授权矩阵的正反向测试；anon key 不能收到未授权行；敏感旧值也不出现在 UPDATE/DELETE event。

## RT-005：改用小型通知 payload，避免行写入受 8KB 限制

推荐触发器只推 `{version, projectId, table, operation, primaryKey}` 等小消息；终端收到后通过受授权 API 刷新行或失效对应缓存。若主键是复合键需可靠 JSON 编码；若 DELETE，需在 OLD 构造 key。

- 目标 API 必须再次校验 projectId/table/row 权限；不能把未经授权的 arbitrary SELECT 暴露给项目 anonKey。
- 对无法投影的表可发 invalidate-all（极小 payload），或使用 outbox 表存完整事件并通过分页 API 读取。
- trigger DDL 应能升级既有函数，避免部分 deploy 时函数与消息 schema 不兼容；消费者需接受版本字段。

**验收**：大于 8KB 的行成功写入，通知 payload 小于限制；SQL DML 结果不依赖 WebSocket 在线状态。

## RT-006：原子化同 channel 初始化并处理 socket 操作竞态

- Service 在第一个 await 前 `Map.set(channel, entry)`，其中 entry 保留 `ready` Promise。第二个 subscribe 先取得 entry、加入 callback，再 await 同一个 `ready`。
- 失败时只允许初始化的 generation 清除自己写入的 Map 项，防止旧连接失败回调删除已替换的新 entry。
- Gateway 按 `${socket.id}:${channel}` 保存状态及取消 token。subscribe: 先登记 pending 状态，再 join/初始化；await 后重新检查 `client.connected`、pending token 与取消标志；任何条件不符就撤销 callback/leave room。disconnect 时 pending 操作也打取消标记，而不只清已完成项。
- unsubscribe 对 pending subscribe 设置 cancel；对 ready subscribe 移除 callback 和 leave room。最后 callback 的 service cleanup 用同一 entry identity 和关闭锁，避免关闭期间新订阅复用正在销毁的 Client。
- room 以 projectId+安全 channel id 生成。多个客户端可共享回调 channel，但每个 callback 仅把事件发送到自己的授权 room。

**验收**：并发订阅 100 次仍只有一 client/一次事件；subscribe/disconnect/unsubscribe 的所有交错顺序最终状态一致；A socket 退订不会影响 B socket。

## RT-007：明确 best-effort 语义、补同步和订阅 ACK

- Socket event 定义 ACK contract：`subscribe` 成功只有在 PG LISTEN ready 后返回 `{ok:true}`；失败返回有稳定 code 的 `{ok:false}`。unsubscribe 同样返回 server state。Gateway 捕获错误，不静默 reject。
- 前端仅在 ACK 成功后更新 Listening 状态；失败时 toast/恢复 switch。切页 cleanup 发送 unsubscribe 或断开后确保 Gateway disconnect 清理完成。
- 当前 UI 是 event feed，可接受断线 gap 时，将通知命名/文档为“变更提示”，重连时调用 API 重新读取当前快照并在 UI 标注历史事件可能有缺口。
- 若产品要求不可丢事件，不以 LISTEN/NOTIFY 为唯一日志：同写事务写 outbox/change-log，使用单调序列、租户/表游标、重放与去重。Socket 仅作唤醒提示。

**验收**：失败订阅不会显示 Listening；断线后当前数据通过 snapshot/cursor 同步一致；若采用 outbox，故障恢复后消费不丢且幂等。

## 建议实施顺序与依赖

1. RT-001 输入安全和 DB least-privilege；同步 RT-003 基础限额，先控制公开攻击面。
2. RT-006 单 flight 初始化/取消竞态，构成稳定生命周期基础。
3. RT-002 error/close/reconnect state machine；依赖 RT-006 entry 生命周期。
4. RT-004 表级/列级授权，需先确认产品“enable”语义；最好与 RT-001 同批验收。
5. RT-005 compact payload，确保写入不会因通知体大小失败。
6. RT-007 ACK 与重连同步；若要求可靠事件再做 outbox。

每步先加入 `test-plan.md` 对应回归用例，再修改实现。修复时不要把 event recovery、Socket 重试和 DB Client 重试各自独立实现成三个无协调的 retry loop。

## RT-008：用稳定唯一内部名生成 trigger function

- **推荐实现**：根据 project UUID + table identity/name 计算固定长度 lowercase hex suffix/完整内部标识符，保证 schema 内唯一且总长 ≤ 63 bytes；不要只对用户表名追加后缀。持久化或复算一致映射，使 disable 和迁移能定位同一函数。
- **涉及文件**：`apps/api/src/realtime/trigger.service.ts`，必要时在 project/table metadata 记录映射。
- **替代方案**：把最大表名约束降至 suffix 可容纳长度，改动小但需 API/数据库层一致验证且可能影响已存在表；不如 hash 名稳健。
- **失败与兼容性**：上线时需识别旧函数名，确保新 trigger 指向新唯一函数后再清理旧函数，避免切换窗口失去通知。
- **修复顺序**：与 RT-004 trigger/table authorization 一起做，早于新增长名称表的功能。
- **验证**：两表共享超过 56-byte 前缀时函数名仍不同、trigger 分别指向正确函数，事件不可串表。
