# Realtime 修复实施报告

## 报告范围

本文记录本次 Realtime 修复在当前工作区中的代码与文档变更，说明它们对应的审查问题、行为变化、验证结果和部署要求。问题编号沿用 [审查问题清单](issues.md) 和 [修复建议](recommendations.md) 中的 `RT-001` 至 `RT-008`。

已修改的主要实现位于 `apps/api/src/realtime/`、`apps/web/src/features/realtime/` 和 `packages/novabase/src/realtime/`。同时更新了共享事件类型、Realtime 文档，并增加了 API 单元测试。以下结论来自源码及本地测试；Neon/PostgreSQL 实际环境验证尚未完成。

## 总览

本次改动将 Realtime 从“客户端可直接请求任意表、长期数据库监听状态缺乏协调、广播完整行数据”的实现调整为：仅接受经项目元数据确认已启用的表、限制连接与订阅资源、对数据库监听状态进行单飞初始化和断线恢复、向客户端发送小型变更元数据，并通过订阅 ACK 同步客户端状态。

| 问题 | 处理结果 | 主要变化 |
|---|---|---|
| RT-001 LISTEN SQL 安全性 | 源码层已缓解；真实驱动/DB 权限仍需验证 | 表名白名单校验；仅允许已启用表；channel 使用服务端 hash；动态标识符引用；避免直接将客户端表名用于 LISTEN。 |
| RT-002 数据库订阅状态与连接恢复 | 已实现应用层恢复和清理 | 监听 Client 状态统一管理；处理初始化及运行时错误；退避重试；有订阅时维持恢复；支持关闭清理。 |
| RT-003 未受限的连接和订阅资源 | 已加入应用层上限 | 限制每 socket 订阅数、每项目和每进程订阅/channel 数，以及每项目和每进程 Socket 数。 |
| RT-004 行数据暴露与授权边界 | 行内容已移除；业务 ACL 待确认 | Trigger 不再推送 NEW/OLD 行；anon key 对显式启用表的变更元数据可见性仍取决于现行产品授权策略。 |
| RT-005 NOTIFY 大 payload 导致事务失败 | 源码层已修复 | Trigger 发送固定的小型 invalidation event，避免把完整记录序列化到 NOTIFY。 |
| RT-006 并发订阅及断开竞态 | 已修复并加入竞态测试 | 同 channel 初始化使用 single-flight；Gateway 在异步订阅前登记 pending 状态，取消后清理迟到的订阅。 |
| RT-007 无 ACK、断线期间事件语义不清 | 增加快照重同步；逐条历史仍 best-effort | 增加 subscribe/unsubscribe ACK、重连重新订阅与恢复状态反馈；订阅 ACK 成功后读取最多 1000 行当前快照。NOTIFY 仍无回放。 |
| RT-008 PostgreSQL 标识符长度/截断碰撞 | 源码层已修复 | channel、函数和 trigger 名使用固定长度 hash 派生标识符；启用时先建新 trigger 再移除旧 trigger。 |

## 按模块说明变更

### API Gateway 与订阅入口

文件：

- `apps/api/src/realtime/gateways/realtime.gateway.ts`
- `apps/api/src/realtime/gateways/realtime.gateway.spec.ts`

主要变化：

- 连接时检查项目 JWT：要求 token 存在且为字符串、长度不超过 4096；验证签名及项目 UUID，并只接受 `anon` 或 `service_role` 项目角色。
- 增加每 socket、每项目和每 API 进程的 Socket 数限制。默认值分别为每项目 500、每进程 2000；可通过 `REALTIME_MAX_SOCKETS_PER_PROJECT`、`REALTIME_MAX_SOCKETS` 配置。
- 将 Socket.IO 最大消息体限制为 16 KiB，并对表名执行 ASCII 标识符格式和长度检查。
- 订阅请求在等待数据库 Service 前登记 pending 状态；退订或断开发生在 await 期间时，会在订阅完成后撤销迟到的 callback，避免断开的客户端留下监听。
- 每个 socket 最多 10 个订阅。订阅和退订现在返回 ACK；对客户端返回通用错误，不透传数据库内部错误详情。
- 对数据库 listener 重连和恢复向客户端发送状态事件。

### 数据库监听 Service

文件：`apps/api/src/realtime/realtime.service.ts`、`apps/api/src/realtime/realtime.service.spec.ts`

主要变化：

- 在创建 Neon Client 前，通过参数化元数据查询确认 project schema 中存在目标表且其 Realtime trigger 已启用；拒绝未启用表，缩短恶意订阅可触达的数据库操作路径。
- LISTEN/UNLISTEN 使用服务端生成的 hash channel，并对 SQL 标识符进行引用；客户端输入不再决定任意 channel 名称。
- 同一个 channel 的连接初始化采用 single-flight：先将初始化状态放入 Map，再等待连接和 LISTEN，避免并发首订阅覆盖彼此的状态或重复创建 Client。
- 将订阅生命周期按 connecting/ready/retrying/closing 管理；connect/LISTEN 初始化失败会尝试关闭 Client。运行时 error/end 会清理旧状态，并在仍有订阅者时按指数退避恢复，最长间隔 30 秒。
- callback 使用集合共享，单个 socket 退出不会移除其他订阅者的 callback；最后一个 callback 退出才会停止该 channel 的监听。
- 增加 Service 的订阅/channel 预算：默认全进程 2000 个订阅、每项目 200 个订阅、200 个 channel，可通过 `REALTIME_MAX_SUBSCRIPTIONS`、`REALTIME_MAX_SUBSCRIPTIONS_PER_PROJECT`、`REALTIME_MAX_CHANNELS` 配置。
- 解析通知时检查 projectId、table、事件类型和 timestamp；隔离 callback 异常，避免一个消费者异常中断同 channel 的其他 callback。
- 应用关闭时清理定时重试与数据库 Client。

这些上限是**单 API 进程**上限；部署多个实例时，数据库连接和 Socket 预算会随实例数相乘。默认配置需结合目标 Neon 配额和部署规模复核。

### Trigger 创建与通知载荷

文件：

- `apps/api/src/realtime/trigger.service.ts`
- `apps/api/src/realtime/realtime.controller.ts`

主要变化：

- trigger/channel/function 名称从 projectId 和 tableName 派生短 hash，避免长表名经 PostgreSQL 63 字节标识符截断后发生碰撞。
- 对标识符进行严格校验和引用，对 SQL 字符串字面量进行转义。
- 通知仅包含版本、操作类型、表名、`record: null`、项目 ID 和时间戳，不再广播 NEW/OLD 行。
- 启用时先创建新版本 trigger，再移除旧版 trigger；创建采用重复对象保护，降低重复启用时失败的风险。
- 禁用入口传入 projectId，以便定位并删除新旧版本 trigger。

旧版本 trigger 的迁移需要主动执行：对已有启用表再次通过管理端启用 Realtime。旧 trigger 在替换前仍会发送旧频道和完整行 payload；大记录仍可能触发 PostgreSQL NOTIFY payload 上限并使对应 DML 事务失败。迁移时应优先处理大字段表，并确认所有活动表都已切换。

### Web Realtime UI

文件：`apps/web/src/features/realtime/realtime-client.tsx`

主要变化：

- UI 等待订阅/退订 ACK 后再更新 listening 状态，并展示 pending 与表级错误，避免仅因发送请求就显示订阅成功。
- Socket 重连后重新订阅；重订阅失败会回滚对应的本地 listening 状态。
- 数据库 listener 恢复状态与 Socket 连接状态分开处理，避免把数据库重连误报成 Socket 断开。
- 表名作为 URL path component 编码。
- UI 说明事件为元数据通知，不再声称事件携带记录内容。
- 订阅 ACK 成功后（首次订阅及 Socket 重连补订阅），以及服务端报告 DB listener 恢复后，调用现有 `GET /api/projects/:projectSlug/rest/:table`，使用项目 anon key 读取 `limit=1000` 的当前行快照；UI 显示同步时间、行数及前 10 行预览，并提供手动刷新。退订时取消正在进行的快照请求并清除该表快照。
- 快照失败单独显示错误，不会把已成功的实时订阅回滚；快照请求使用 `cache: 'no-store'`，不会缓存旧数据。

这实现的是**最新状态对齐**，不是逐条事件补放。快照最多包含 API 当前支持的 1000 行，较大表只能得到部分快照；断线期间发生后又被覆盖/删除的中间状态无法从当前表还原。若需要完整 CDC 历史，仍需持久化 outbox/cursor 方案。

### SDK 与事件类型

文件：

- `packages/novabase/src/realtime/index.ts`
- `packages/novabase/src/index.ts`
- `packages/novabase/src/types.ts`
- `packages/types/src/index.ts`
- `docs/realtime/realtime.md`

主要变化：

- SDK 订阅等待服务端 ACK，支持可选的 `onError` 回调，并在重连时重新订阅。
- 注册 callback 后再发起订阅；复用正在连接或重连中的 socket，减少重复创建 socket 的可能；隔离用户 callback 抛出的异常。
- 导出 `RealtimeSubscriptionError`。
- 共享事件类型将 `record` 表达为可选/null，`version` 可选，旧 `oldRecord` 也不再要求存在，以兼容仅含元数据的新事件。
- SDK/Realtime 文档声明事件是 best-effort invalidation metadata，不携带行数据，也不提供断线期间的 replay。

这是对事件 payload 的行为兼容性变化：消费方不能再依赖 `record` 或 `oldRecord` 获取行内容。需要最新行状态的客户端应收到通知后通过有权限的 API 查询数据。

## 验证结果

当前工作区记录的本地验证结果：

- `pnpm --filter api exec vitest run src/realtime`：10 个 Realtime 测试通过。
- `pnpm --filter api test`：API 全量测试 11 个通过。
- API TypeScript `tsc --noEmit`：通过。
- Realtime 目录 Oxlint：通过。
- SDK TypeScript `tsc --noEmit`：通过。
- Realtime Web ESLint：通过。

以上是 Mock/unit 和静态检查结果，不代表真实数据库集成验收。尚未在 Neon/PostgreSQL 上验证 trigger DDL、NOTIFY payload 边界、Neon 驱动真实 error/end 事件、权限 grants 或网络中断恢复。详细场景见 [测试计划](test-plan.md)。

## 推荐上线与修复顺序

1. **先验证配置和攻击面**：确认 `REALTIME_DATABASE_URL` 在目标环境的实际配置与数据库角色 grants。Service 当前存在使用 `DATABASE_URL` 作为 fallback 的可能；需要确认所用凭据只拥有 Realtime 必要权限。
2. **迁移旧 trigger**：在隔离环境逐表重新启用 Realtime，确认新 hash trigger 生效、旧 trigger 被移除，再安排生产逐步迁移；优先迁移含大字段的表。
3. **验证数据库生命周期**：在目标 Neon 版本/网络环境断开并恢复连接，验证重试、资源释放、订阅仍有效以及无重复推送/连接泄漏。
4. **校准资源限制**：按 Neon session quota、API 实例数和预期活跃连接调整每进程限制；多实例总预算按实例数估算。
5. **确认授权产品语义**：当前限制的是可订阅到 Realtime 已启用表并省略行数据；是否需要按用户身份、表/字段 ACL 或行级权限过滤事件，仍需产品决策。
6. **确认投递语义**：当前没有持久化事件、游标或回放。若业务要求断线期间不丢事件，需要单独设计事务 outbox/可恢复游标，而不能仅靠 LISTEN/NOTIFY。

## 尚待确认

- `REALTIME_DATABASE_URL` 是否在所有环境配置为独立的最小权限数据库角色，以及该角色实际可执行的 DDL/DML。
- Neon serverless 1.1.0 在真实网络断开时 error/end/close 的具体事件顺序，以及恢复期间 query 的行为。
- 新旧 trigger 迁移已覆盖哪些项目和表；上线期间旧 trigger 对大 payload 的风险仍存在。
- 多实例部署数量、负载均衡 sticky session、Socket.IO adapter 与连接/数据库额度的实际配置。
- anon key 是否应允许订阅全部已启用表的变更元数据；当前改动没有实现用户级或行级事件授权。
- 产品是否接受 best-effort 语义及断线时可能丢失事件。

