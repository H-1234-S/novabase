# 任务：把 Realtime 从 best-effort 通知升级为「事务 outbox + 游标」的逐条不丢投递

你在 novabase 仓库（pnpm monorepo）里工作。先读 `AGENTS.md` 和下面列出的现有文件，再动手。**如果下面的描述与仓库现状冲突，停下来指出冲突，不要自行猜测。**

## 0. 现有实现（必须理解，不要推翻）

- `apps/api/src/realtime/trigger.service.ts`：管理端 enable 时在项目 schema 的目标表上创建 `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW` 触发器；触发器函数内 `json_build_object(...)::text` 后 `pg_notify(channel, payload)`。payload 只有 `version / type / table / record(null) / projectId / timestamp`，**不含行内容**（这是安全要求，不能改）。
- `apps/api/src/realtime/realtime.service.ts`：用 `@neondatabase/serverless` 的 `Client`（WebSocket，直连，剥掉 `-pooler`）执行 `LISTEN "<channel>"`，一个 channel 一个 Client，多个 socket 共享；已有指数退避重连（500ms × 2^n，封顶 30s）。
- `apps/api/src/realtime/gateways/realtime.gateway.ts`：`/realtime` 命名空间，握手用 `PROJECT_JWT_SECRET` 验 anon/service_role key；每个 socket 维护 `socketSubscriptions`；订阅成功后才 join `project:{id}:table:{name}` 房间；订阅/退订都有 ACK。
- `apps/web/src/features/realtime/realtime-client.tsx`：`subscribedRef` 保存订阅表，`connect` 时重放 subscribe（5s ACK 超时）；已有 `syncTableSnapshot()`，在订阅成功、Socket 重连、`LISTENER_CONNECTED`、手动 Refresh 时用 `GET /api/projects/:slug/rest/:table?limit=1000` 拉当前行。
- `packages/constants/src/index.ts`：`REALTIME_EVENTS = { SUBSCRIBE, UNSUBSCRIBE, EVENT, ERROR }`。
- `packages/types/src/index.ts`：`RealtimeEvent` 类型。
- `packages/novabase/src/realtime/index.ts`：对外 SDK，目前只有重订阅，没有游标。

现在的问题：`pg_notify` 是瞬时通知，不落库、无 offset，断线期间的变更永久丢失，只能用快照对齐当前状态，不能补回逐条变更。

## 1. 目标语义

**至少一次投递 + 客户端按 seq 幂等去重 + 单调游标**。具体：

1. DML 与事件写入在**同一个数据库事务**内完成（由触发器保证）。
2. 每条事件有单调递增的 `seq`，可作为游标。
3. 客户端按表持有 `cursor`；重连/重订阅时带上 `since`。
4. 服务端补投 `(since, now]` 区间内该表的所有事件，再转实时投递。
5. 补投量超过上限或已超出保留窗口时，返回 `gap: 'expired'`，客户端退回快照对齐（复用现有 `syncTableSnapshot`）。
6. 对客户端可见的效果：**不丢**；最多重复一条（客户端按 seq 丢弃），不允许乱序。

不做行内容投递，不做 exactly-once，不引入 Redis/Kafka。

## 2. 数据模型（项目 schema 内，运行时 DDL）

outbox 属于**项目自己的 schema**（`projects.db_schema`），不要建在 `public`，不要加 drizzle migration（drizzle 只管 public）。

在 `TriggerService.enableRealtime()` 里，**建触发器之前**先建表：

```sql
CREATE TABLE IF NOT EXISTS {schema}."_rt_outbox" (
  seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text        NOT NULL,
  op         text        NOT NULL,
  payload    jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS "_rt_outbox_table_seq_idx"
  ON {schema}."_rt_outbox" (table_name, seq);
```

`payload` 就是现在 NOTIFY 的那份元数据（不含 `seq`，读取时拼）。

**必须处理的两件事：**

- `_rt_outbox` 会出现在 `information_schema.tables` 里。修改 `apps/api/src/table-editor/table-editor.service.ts` 的 `getTables()`，用 `AND table_name NOT LIKE '\_rt\_%'` 过滤掉所有 `_rt_` 前缀的内部表（否则 Table Editor / API Docs / Realtime 页面的表清单会多出这张表）。
- 保留策略：新增 `RealtimeOutboxService`（`apps/api/src/realtime/realtime-outbox.service.ts`），每 10 分钟清理一次超过 `REALTIME_OUTBOX_RETENTION_HOURS`（默认 24）的行。仓库没有 `@nestjs/schedule`，用 `setInterval(...).unref()` 在 `onModuleInit` 启动、`onModuleDestroy` 清除；清理前用 `pg_try_advisory_lock` 抢锁，抢不到就跳过（多实例下只让一个实例做）；删除用 `WHERE ctid IN (SELECT ctid FROM ... WHERE created_at < now() - interval LIMIT 1000)` 分批，避免长事务。项目 schema 列表从 `public.projects` 查。

## 3. 触发器改造（`trigger.service.ts`）

同一个函数里，**先写 outbox 拿 seq，再 NOTIFY 带 seq**：

```sql
CREATE OR REPLACE FUNCTION {schema}.{fn}()
RETURNS TRIGGER AS $$
DECLARE
  v_seq bigint;
  v_payload jsonb;
BEGIN
  -- 关键：串行化同一张表的 seq 分配，保证 seq 顺序 == 提交顺序
  PERFORM pg_advisory_xact_lock(hashtextextended('{projectId}:' || TG_TABLE_NAME, 0));

  v_payload = jsonb_build_object(
    'version', 1,
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'record', NULL,
    'projectId', {projectIdLiteral},
    'timestamp', clock_timestamp()::text
  );

  INSERT INTO {schema}."_rt_outbox" (table_name, op, payload)
  VALUES (TG_TABLE_NAME, TG_OP, v_payload)
  RETURNING seq INTO v_seq;

  PERFORM pg_notify(
    {channelLiteral},
    (v_payload || jsonb_build_object('seq', v_seq::text))::text
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**为什么必须加 `pg_advisory_xact_lock`（不要省略，也不要换成别的写法）：**

`IDENTITY` 的 seq 是在 INSERT 时分配的，但 NOTIFY 在**提交时**才投递。两个并发事务可能 A 拿到 seq=5、B 拿到 seq=6，B 先提交 → 服务端先看到 6，水位推进到 6，随后 A 提交推 5 时会被当成重复丢掉，**5 就永久丢了**。按 `(projectId, table)` 加事务级 advisory lock 后，同表内「拿 seq」与「提交」严格串行，seq 顺序 == 提交顺序，水位（max seq）语义才成立。代价是同表写入串行化，这个 trade-off 要写进实现报告的「已知代价」一节，不要偷偷去掉锁。

其余要求：

- 保留现有的 `CREATE OR REPLACE FUNCTION`、`CREATE TRIGGER ... EXCEPTION WHEN duplicate_object`、legacy trigger 清理顺序（先建新再删旧）。
- 所有 schema / 表名 / 函数名继续走 `quoteIdentifier()`，所有字符串字面量继续走 `quoteLiteral()`，不要拼接未转义值。
- NOTIFY payload 必须远小于 PostgreSQL 8000 字节上限；不要因为加了 seq 就把 `payload` 整段塞进 NOTIFY（现在是 ~200 字节，保持这个量级）。
- `disableRealtime()` 不删 outbox 表（其他表可能仍在用），只删触发器。

## 4. 投递协议（gateway + service）

### 4.1 订阅载荷升级

`subscribe` 的 `@MessageBody()` 从「表名字符串」升级为：

```ts
type SubscribePayload = { table: string; since?: string };
```

**必须继续接受裸字符串**（视为 `{ table, since: undefined }`），否则现有 SDK 与旧页面会直接断掉。`since` 必须是十进制数字字符串，长度 ≤ 20，用 `BigInt()` 校验，非法则 ACK `{ ok:false, code:'INVALID_CURSOR' }`。

### 4.2 ACK 契约

```ts
type AckResponse =
  | { ok: true; cursor: string; gap: 'none' | 'replayed' | 'expired'; replayed: number }
  | { ok: false; code: string; message: string };
```

- `gap: 'none'`：`since` 已是最新，无补投。
- `gap: 'replayed'`：补投了 `replayed` 条，`cursor` 为补投后的水位。
- `gap: 'expired'`：`since` 早于保留窗口起点，或缺口条数超过上限，**不补投**，`cursor` 返回当前水位，客户端必须走快照。

### 4.3 补投时序（顺序不能改）

`handleSubscribe()` 里：

1. 校验表名、占位 `socketSubscriptions`（现有逻辑保留）。
2. `realtimeService.subscribe(...)` 建立/复用 LISTEN（现有逻辑保留，此时新 socket **还没进房间**）。
3. **第一遍补投**：`realtimeService.replay(projectId, tableName, since, onEvent)`，把 `seq > since` 的行按 `seq ASC` 取最多 `REALTIME_MAX_REPLAY_ROWS`（默认 500，硬顶 1000）条，逐条 `client.emit(EVENT, ...)`（只发给这个 socket，不发房间）。
4. `client.join(room)`。
5. **第二遍补投**：用 `since = 第一遍最后一条的 seq` 再查一次并只发给该 socket。这一步用来封住「第一遍查询」到「join 完成」之间的窗口：这个窗口内提交的行既不在第一遍结果里，也因为 socket 还没进房间而收不到实时广播。
6. `subscription.ready = true`，ACK `{ ok: true, cursor, gap, replayed }`。

判断 `expired`：`since + 1 < (SELECT min(seq) FROM _rt_outbox WHERE table_name = $1)`，或缺口行数 > `REALTIME_MAX_REPLAY_ROWS`。表为空时不算过期。

### 4.4 水位与去重

`ChannelEntry` 增加 `lastEmittedSeq: bigint`（用字符串或 BigInt 存，别用 number）。

- 实时路径（`client.on('notification')`）：解析出 `seq` 后，若 `seq <= entry.lastEmittedSeq` 直接丢弃；否则发给房间并更新水位。
- 第二遍补投可能与实时广播重复（同一条既被查询捞到又被房间广播），**由客户端按 seq 去重**，服务端不需要额外加锁。这个「最多重复一条」的行为要写进注释和文档。

### 4.5 事件形状

`RealtimeEvent` 增加必填字段 `seq: string`（十进制字符串，**不要用 number**：`bigint` 超过 `Number.MAX_SAFE_INTEGER` 会静默丢精度）。同步更新 `packages/types/src/index.ts`，`version` 保持 `1`。

`RealtimeService` 读取 outbox 时用 `SELECT seq::text AS seq, payload FROM ... ORDER BY seq ASC`，再把 `seq` 合并进 payload 作为事件体。

## 5. 客户端（`realtime-client.tsx`）

1. 新增 `cursorRef: Map<string, string>`（每表一个游标），与 `subscribedRef` 同样用 ref 镜像，避免 `connect` 闭包过期。
2. 重放订阅时带上 `since: cursorRef.get(table)`；首次订阅不带。
3. ACK 处理：
   - `gap: 'expired'` → 立即 `syncTableSnapshot(table)` 并把 cursor 设为 `ack.cursor`，在界面上给出「已用快照对齐，断线期间逐条记录不可用」的提示（复用 `snapshotErrors` 或新增一行状态文案，不要静默）。
   - `gap: 'replayed'` → 更新 cursor，并且仍然 `syncTableSnapshot(table)`（补投的是元数据，行状态还是要对齐）。
   - `gap: 'none'` → 更新 cursor。
4. 收到 `event` 时：`if (event.seq && cursor && BigInt(event.seq) <= BigInt(cursor)) return;` 然后更新 cursor 再入 feed。
5. 退订时删除该表的 cursor。
6. 现有 `emitSubscription` 的 5s 超时、失败回滚、`syncTableSnapshot` 的 AbortController 竞态处理全部保留，不要重写。

## 6. SDK（`packages/novabase/src/realtime/index.ts`）

- `subscribe(table, callback, options?: { since?: string; onError?: ... })`，保持现有 `onError` 用法兼容。
- 内部按表维护 cursor，重连重订阅时自动带 `since`，收到事件按 seq 去重。
- `CURSOR_EXPIRED` 要通过 `onError` 抛给调用方（SDK 自己拿不到快照，必须让应用层知道要重新查询）。

## 7. 测试（必须能先失败）

按 `AGENTS.md`：单元测试严格镜像源码目录，一个测试文件只测对应源文件；**先写会失败的测试，再写实现**。

- `apps/api/src/realtime/trigger.service.spec.ts`：断言 DDL 文本包含 `_rt_outbox` 建表、advisory lock、`INSERT ... RETURNING seq`、NOTIFY payload 带 `seq`；非法标识符仍然抛错。
- `apps/api/src/realtime/realtime.service.spec.ts`：补投按 seq 升序、`since` 之后的才返回、缺口超限返回 expired、水位去重（重复 seq 不二次发）、保留窗口过期判定。
- `apps/api/src/realtime/gateways/realtime.gateway.spec.ts`：字符串与对象两种订阅载荷都能解析、非法 `since` 返回 `INVALID_CURSOR`、ACK 带 cursor/gap、补投在 join 之前、断连中途取消不留下订阅。
- `apps/web` 没有测试基建就不要硬加，改为在报告里给出可复现的手工验证步骤。

跑通：`pnpm --filter api exec vitest run src/realtime`、`pnpm --filter api test`、`pnpm --filter api exec tsc --noEmit`、`pnpm --filter novabase exec tsc --noEmit`。

## 8. 验收标准

1. 订阅某表 → 断开网络 30s → 期间用 REST 插入 5 行 → 恢复网络：feed 里出现这 5 条，seq 严格递增，无重复。
2. 同一条变更不会在 feed 里出现两次（客户端按 seq 去重生效）。
3. 手动把 outbox 里旧行删掉后再用旧 cursor 重连 → 返回 `gap: 'expired'`，界面走快照并给出提示，不假装补投成功。
4. `_rt_outbox` 不出现在 Table Editor 的表清单、API Docs、Realtime 页面的表清单里。
5. 触发器 DDL 仍通过标识符注入测试；`record` 仍为 `null`（不投递行内容）。
6. 现有 realtime 的 10 个测试全部通过。
7. 多实例部署下不会重复清理 outbox（advisory lock 生效）。

## 9. 明确不做

- 不投递 NEW/OLD 行内容。
- 不实现 exactly-once、不引入外部消息队列、不做 outbox 分区。
- 不改 `public` schema，不加 drizzle migration，不跑 `db:push`。
- 不手改 `dist/`、不提交 `.env`。
- 不重写 `syncTableSnapshot`、退避重连、ACK 超时这些已经稳定的逻辑。

## 10. 交付物

- 上述代码改动。
- `fixes/realtime/outbox-implementation-report.md`：改了什么、协议契约、**已知代价（advisory lock 的写入串行化、outbox 增长与保留窗口、1000 条补投上限）**、未覆盖的场景、验证命令与结果。
- 更新 `docs/realtime/realtime.md`：把「断线期间的通知不会回放」改成新的游标语义，并说明 `gap: expired` 时退回快照。
- 更新 `packages/novabase/README.md` 的 Realtime 章节。
