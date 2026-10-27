# Realtime 持久事件补偿实施记录

日期：2026-10-22

## 范围

本次按 `.workbuddy-ai/prompts/realtime-outbox-cursor.md` 实施 outbox/cursor 数据补偿，未连接目标 PostgreSQL/Neon，也未修改环境变量或执行 migration。此前工作区已有的 Realtime 修复均予以保留。

## 实施内容

### 数据库事务 Outbox

- `apps/api/src/realtime/trigger.service.ts` 在表启用 Realtime 时创建项目 schema 下的 `_rt_outbox` 与 `_rt_outbox_state`，为每个变更生成 identity `seq`，保存不含行内容的紧凑事件，并在同一业务事务内调用 `pg_notify`。
- Trigger 使用按 project/table 的 `pg_advisory_xact_lock` 串行化同表 seq 分配及提交顺序，降低 cursor 推进越过尚未提交事件的风险。代价是同一表的触发器片段会串行执行。
- `_rt_outbox_state` 分表记录最新 seq 和过期水位。outbox DELETE trigger 推进对应表的水位，避免全局 identity 序列中其他表产生的合法空洞被误判为数据过期。
- `_rt_` 前缀被保留；Table Editor 和项目 REST 表访问路径隐藏/拒绝内部表，避免用户将 outbox 当作普通业务表访问。

### 回放及订阅竞态

- `apps/api/src/realtime/realtime.service.ts` 提供当前 cursor 与有界 replay 查询；cursor 只接受十进制 BIGINT 范围。回放超过 `REALTIME_MAX_REPLAY_ROWS`（缺省 500，最多 1000）或早于每表过期水位时返回过期 gap。
- `apps/api/src/realtime/gateways/realtime.gateway.ts` 接受 `{ table, since }`，先注册监听并回放，再加入 socket room 并二次回放；回放期间缓存 NOTIFY，按 seq 排序并去重后直接发给订阅 socket。新订阅不传 cursor 时先取得 LISTEN 前基线，不默认重播整个保留历史。
- 数据库 listener 重连后从 socket 当前 cursor 回放。若历史已过期则给客户端发 `CURSOR_EXPIRED`，由上层读取当前快照；这不能恢复已经被后续更新/删除覆盖的中间行状态。
- 事件类型补充字符串 `seq`。SDK 支持 `since`、维护当前实例的每表 cursor、断线重订阅时携带 cursor，并通过 `onError` 通知应用处理过期 cursor。跨进程重启的可靠恢复仍要求应用在成功处理事件后持久化 cursor。

### 清理及保留

- 新增 `apps/api/src/realtime/realtime-outbox.service.ts`，模块启动时立即运行并每 10 分钟扫描；缺省保留 24 小时，可由 `REALTIME_OUTBOX_RETENTION_HOURS` 配置。
- 每个项目 schema 每轮最多删除 10 批、每批最多 1000 行。单条 DELETE SQL 通过 `pg_try_advisory_xact_lock` 防止多 API 实例同时清理；锁和删除在同一语句事务范围内，适配当前 Drizzle Neon HTTP provider 不支持交互式事务的情况。
- 清理只删除过期事件，不删除共享 outbox/state 表。当前实现不清理不再启用 Realtime 的表状态行。

### 客户端及文档

- Web 控制台使用 ACK cursor、在重连时携带 cursor，并在 cursor 过期、listener 恢复等情况下触发 REST 快照同步。
- 更新 `docs/realtime/realtime.md`、`packages/novabase/README.md`、`fixes/realtime/README.md` 和本测试计划，说明回放窗口、cursor 持久化责任、过期降级、升级时重新 enable trigger 和验证限制。

## 关键协议语义

- 保留期内按 seq 提供至少一次的可重放事件；不是 exactly-once。客户端应以 seq 幂等处理并在处理成功后持久化 cursor。
- 默认无 cursor 的订阅仅从建立订阅时的基线开始；如果客户端要恢复重连之前的数据，必须传递保存的 cursor。
- `gap: 'expired'` 表示无法保证逐条历史完整，客户端应从当前数据源读取快照。
- Outbox 存的是操作元数据（类型、表、项目、时间），不包含历史行镜像；快照无法重建已被覆盖的中间状态。
- 新 trigger 只在 enable 路径创建。既有表升级时需重新执行管理端 enable；逐表迁移完成前不能宣称历史触发器已写入 outbox。

## 主要变更文件

- API：`apps/api/src/realtime/trigger.service.ts`、`realtime.service.ts`、`realtime.module.ts`、新增 `realtime-outbox.service.ts`、Gateway；项目 API 和 Table Editor 增加内部表保护。
- 类型及 SDK：`packages/types/src/index.ts`、`packages/novabase/src/types.ts`、`packages/novabase/src/realtime/index.ts`、`packages/novabase/src/index.ts`。
- Web：`apps/web/src/features/realtime/realtime-client.tsx`。
- 文档：Realtime 指南、SDK README、修复摘要及测试计划。

## 验证状态

已运行以下无数据库凭据验证：

- `pnpm --filter api test`：通过，5 个测试文件、19 个测试。
- `pnpm --filter api exec tsc --noEmit`：通过。
- `pnpm --filter api exec oxlint src/realtime`：通过。
- `pnpm --filter @hushaoqiong/novabase exec tsc --noEmit`：通过。
- `pnpm --filter web exec eslint src/features/realtime/realtime-client.tsx`：通过。
- `git diff --check`：通过；Git 仅提示工作区行尾转换警告。
- `pnpm --filter web exec tsc --noEmit`：未通过，错误来自 `.next/types/validator.ts` 引用不存在的 `src/app/api/proxy/[...path]/route.js` 和 `src/app/auth/callback/route.js`；该生成目录错误不指向本次 Realtime 文件。

以上 mock/unit 验证不替代真实 PostgreSQL/Neon 集成测试，发布前仍需验证：

1. Trigger DDL 与 `ON CONFLICT` SQL 在目标 PostgreSQL 版本执行成功。
2. `pg_advisory_xact_lock` 在触发器内确实令同表 seq 与提交顺序一致，且评估对写吞吐的影响。
3. DELETE trigger 对 TTL 清理、手工 DELETE、批量 DELETE 推进正确的 per-table 水位；不得对 outbox 使用 TRUNCATE。
4. Neon HTTP 执行带 CTE、锁函数和 DELETE trigger 的单 statement；两个实例争锁时只有一个实例执行删除。
5. 旧 trigger 升级和逐表 enable 流程成功，rollback 与 DDL 失败不会留下部分状态。

## 限制与回滚考虑

- 当前没有数据库 migration；表和 trigger DDL 由 enable 管理接口幂等创建。上线前应先部署兼容服务端，再逐表重新 enable 并核对 outbox 有新 seq。
- DDL 是多条语句，不包在事务中；若中途失败可能留下已创建的内部表/函数，但重复 enable 设计为可继续完成。需在 PostgreSQL 集成环境故障注入验证。
- 数据补偿仅覆盖 trigger 已部署后产生、且尚未过保留期的事件。序列化同表写入可能带来吞吐成本；按高写入表压测并结合数据库连接/锁等待监控评估。
- 若清理配置变更为较短保留期，已过期事件不可恢复；应通过 `CURSOR_EXPIRED` 执行快照对齐。
