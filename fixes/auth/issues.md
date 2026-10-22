# 用户认证问题

## [AUTH-001] 注册写入用户、组织和成员关系没有事务保护

- **优先级**：P2
- **问题类型**：数据一致性 / 异常处理
- **涉及文件**：`apps/api/src/auth/auth.service.ts`
- **涉及位置**：`AuthService.register()`；`handleOAuthUser()` 新用户分支
- **问题描述**：注册先插入 `users`，再插入 `organizations`，最后插入 `orgMembers`，三次写入不是同一事务。OAuth 首次登录也采用相同的分步创建方式。
- **触发条件**：任一步遇到数据库中断、约束冲突或服务异常。
- **根因分析**：上游 controller 只在 `register()` 完成后发 Cookie；但早先用户写入不会回滚。下次注册同邮箱会走冲突，留下无法进入组织的孤立账户。OAuth 首次登录失败后重试也可能因已存在用户而跳过组织初始化。
- **影响范围**：密码注册与 Google/GitHub 首次登录后的账户和默认组织创建。
- **修复建议**：将必要数据库写入放入同一个 Drizzle transaction；OAuth 创建采用冲突安全的 upsert/锁定流程，确保并发首次登录不会漏建组织或重复建成员。
- **验证方式**：模拟在组织/成员插入阶段失败，断言用户记录也回滚；并发执行相同邮箱首次 OAuth 流程，断言只得到一个用户、默认组织及管理员关系。
- **置信度**：已确认

## [AUTH-002] OAuth 登录缺少 state 校验且未验证 Google 邮箱状态

- **优先级**：P2
- **问题类型**：认证安全 / 业务逻辑
- **涉及文件**：`apps/api/src/auth/auth.service.ts`、`apps/api/src/auth/auth.controller.ts`
- **涉及位置**：`getGoogleAuthUrl()`、`getGithubAuthUrl()`、`handleGoogleCallback()`、`handleGithubCallback()` 及两个 callback controller 方法
- **问题描述**：授权 URL 未生成或绑定一次性 `state`，回调也不验证 state；Google userinfo 的类型和后续逻辑只读取 `email/name/picture`，未校验 `email_verified`。此外 token/profile 响应均未检查 `response.ok`。
- **触发条件**：用户处于已登录攻击者网站时访问攻击者准备的 OAuth callback 流程（登录 CSRF）；或身份提供商返回未验证邮箱/错误响应。
- **根因分析**：回调只凭 URL 中的 `code` 交换资料并按 email 复用/创建本地用户，然后立即签发本系统 Cookie，没有关联发起登录的浏览器会话。未经验证的邮箱可能与已有账户 email 对应。
- **影响范围**：平台级 Google/GitHub 登录及账户关联；错误响应可能造成异常 JSON/属性访问错误。
- **修复建议**：发起授权时生成高熵 state 并通过安全短期 Cookie/服务端存储绑定，回调校验并一次性消费；校验 Google `email_verified === true`，GitHub 仅采用 `verified && primary` 邮箱；检查每次 HTTP 状态及必需字段后再 upsert。
- **验证方式**：缺失、篡改、重放 state 均拒绝；未验证邮箱不得登录/关联；模拟非 2xx 和缺少 access token 的响应，得到受控认证错误且不创建账户。
- **置信度**：已确认
