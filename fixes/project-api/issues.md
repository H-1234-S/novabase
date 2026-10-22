# 项目公开 REST API 问题

## [API-001] anon key 可读项目 schema 任意表，包括认证密码哈希

- **优先级**：P1
- **问题类型**：数据泄露 / 多租户安全
- **涉及文件**：`apps/api/src/project-api/project-api.controller.ts`、`apps/api/src/project-api/project-api.service.ts`、`apps/api/src/project-auth/project-auth.service.ts`
- **涉及位置**：`getRows()` 不区分 key role；动态 `SELECT ... FROM schema.table`；`ensureAuthUsersTable()` 创建含 `password_hash` 的 auth_users
- **问题描述**：公开 GET 只要求有效项目 key（包括 anon），并允许调用者指定项目 schema 任意表。无表 allowlist 或敏感列过滤，因此 `/projects/:slug/rest/auth_users` 默认 `SELECT *` 会返回密码哈希。
- **触发条件**：使用通常会放在客户端的项目 anon key 请求 auth_users。
- **根因分析**：项目认证表与普通数据共用 schema；REST 只校验表名格式，未授权表或列。bcrypt 哈希仍可被离线破解。
- **影响范围**：启用项目认证并公开 anon key 的项目终端用户凭据及其他未公开表数据。
- **修复建议**：从公共 REST 排除 auth/internal 表，并实现显式表级和列级暴露策略；项目认证数据应使用独立 schema/受限角色。不能依赖前端隐藏表名。
- **验证方式**：anon key 请求 auth_users、未暴露表和敏感列均拒绝；公开表仍按策略工作；hash 不出现在 REST 输出。
- **置信度**：已确认

## [API-002] 过滤参数解析静默放宽查询且负 limit 可绕过上限

- **优先级**：P2
- **问题类型**：业务逻辑 / 参数验证
- **涉及文件**：`apps/api/src/project-api/query-parser.ts`
- **涉及位置**：未知 operator 的忽略分支；`limit = Math.min(parseInt(value, 10) || 100, 1000)`
- **问题描述**：未知过滤条件被静默忽略，调用方以为条件生效但实际返回更宽结果；`limit=-1` 保持为负数（PostgreSQL 中不限行数），`limit=0` 被改成默认 100。无效 order 方向会静默变成 ASC。
- **触发条件**：拼错操作符、limit 传 0/负数/非数字或排序方向无效。
- **根因分析**：采用宽松 `parseInt || default` 与忽略未知 operator，没有失败策略。
- **影响范围**：意外扩大公开数据返回、分页语义异常，极端查询增加响应体和 DB 消耗。
- **修复建议**：严格校验参数；非法条件返回 400；limit 设定明确正数范围；排序方向只接受 ASC/DESC。
- **验证方式**：单测覆盖负数、0、非数字、超上限、未知 operator、缺值、无效 order 和合法过滤。
- **置信度**：已确认
