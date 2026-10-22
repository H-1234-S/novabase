# 项目终端用户认证问题

## [PAUTH-001] 管理端认证路由可跨组织读写其他项目

- **优先级**：P1
- **问题类型**：授权绕过 / 多租户隔离
- **涉及文件**：`apps/api/src/project-auth/project-auth-dashboard.controller.ts`、`apps/api/src/project-auth/project-auth.service.ts`
- **涉及位置**：dashboard 的 users/settings 路由；`getProject(projectSlug)` 只按 slug 查询
- **问题描述**：控制器路径含 `:slug` 组织并由 OrgRoleGuard 验证用户属于该组织，但 service 只使用 `projectSlug`，未确认项目属于 URL 组织。
- **触发条件**：组织 A 成员请求 `/orgs/A/projects/<B项目slug>/auth/settings` 或 `/users`。
- **根因分析**：Guard 授权对象是 URL 组织；controller 丢弃该参数，service 按全局项目 slug 查询并返回/更新项目数据。
- **影响范围**：跨组织读取终端用户邮箱和认证设置，或改写 OAuth client 配置与 siteUrl。
- **修复建议**：dashboard 方法接收 orgSlug，使用 organizations.slug + projects.slug 组合查询；写操作按同一租户范围更新，并明确 OAuth 密钥访问角色。
- **验证方式**：A 组织用户访问 B 项目 users/settings/update 均拒绝；同组织合法操作成功。
- **置信度**：已确认

## [PAUTH-002] 项目 OAuth 回调把 7 天令牌放入 URL query

- **优先级**：P2
- **问题类型**：认证凭证暴露
- **涉及文件**：`apps/api/src/project-auth/project-auth.controller.ts`、`apps/api/src/project-auth/project-auth.service.ts`
- **涉及位置**：Google/GitHub callback 的 `?access_token=...` redirect；`signToken()` 有效期 7d
- **问题描述**：访问令牌经 URL query 交给配置 siteUrl。URL 可能进入浏览器历史、代理/服务器日志、分析系统或 Referer；令牌可用 7 天。
- **触发条件**：用户完成项目 OAuth 登录并重定向；目标页面加载第三方资源或记录 URL。
- **根因分析**：Bearer credential 作为导航 URL 参数传递，没有一次性兑换或短生命周期限制。
- **影响范围**：项目终端用户会话；泄露者可在有效期内冒用用户。
- **修复建议**：使用短时一次性授权码，经前端同源 POST/后端兑换访问令牌；或校验 redirect allowlist 后用受控 Cookie。避免可重放长效 token 出现在 URL。
- **验证方式**：回调 URL、日志和 Referer 不含可重放 token；一次性 code 重放失败。
- **置信度**：已确认
