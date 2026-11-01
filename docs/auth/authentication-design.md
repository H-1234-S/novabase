# 认证与权限校验设计

> 本文描述 novabase 前后端之间「凭证如何携带、服务端如何验证」的完整链路，
> 并对齐现有实现（`apps/api/src/auth`、`apps/web/src/proxy.ts`）指出需要修正的地方。

## 1. 三层身份，不要混用

| 身份 | 代表谁 | 凭证载体 | 生命周期 |
| --- | --- | --- | --- |
| 开发者会话 | dashboard 的注册用户 | HttpOnly Cookie 双 Token | access 15m / refresh 7d |
| 项目终端用户 | 开发者用 SDK 接入的 C 端用户 | 项目级 JWT（每项目独立密钥） | 7d |
| 项目密钥 | SDK / 服务端直连 REST API | `Authorization: Bearer <anon\|service_role>` | 长期，手动轮换 |

三者密钥、受众（audience）、校验入口必须完全隔离。任何一层校验通过都不能推导出另一层权限。

## 2. 凭证放在哪：Cookie 还是 Header

**浏览器（dashboard）用 HttpOnly Cookie，不用 localStorage。**

- HttpOnly 阻断 JS 读取，把「XSS 直接偷走长期凭证」降级为「XSS 在页面内发请求」；
- 配合 SameSite 天然抵御大部分 CSRF；
- 代价：跨站场景需要 `SameSite=None; Secure`，且必须补 CSRF Token。

**SDK / 服务端 / WebSocket 用 Header。**

- REST：`Authorization: Bearer <token>`；
- Socket.IO：`io(url, { auth: { token } })`，在 `handleConnection` 里校验，不能等业务事件再校验。

**Token 永远不进 URL。** `?access_token=...` 会进浏览器历史、Referer、网关日志。
当前 `project-auth.controller.ts` 的 OAuth 回调就是这种写法，应改为回调下发一次性 `code`，
由前端调 `POST /auth/exchange` 换取 token。

## 3. 关键架构决策：同源代理，还是跨站 Cookie

当前实现是「浏览器直连 API」：`NEXT_PUBLIC_API_URL` + `withCredentials: true`。
开发期能跑，是因为 **Cookie 的作用域只看 host，不看端口**，`localhost:3001` 写入的
Cookie 会被带到 `localhost:3000`。生产环境 `app.example.com` 与 `api.example.com`
是两个 host，Cookie 根本不会过去，整条链路会失效。

两个可选方案：

### 方案 A：Next 同源代理（推荐）

```ts
// apps/web/next.config.ts
const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL}/api/:path*` }];
  },
};
```

浏览器只请求 `https://app.example.com/api/*`，由 Next 服务端转发到 Nest。

- Cookie 是 host-only，`SameSite=Lax` 直接可用，无需 CSRF Token；
- 不需要 CORS，也不需要 `credentials: 'include'`；
- API 可以完全不暴露公网，只允许 web 服务访问；
- 前端代码里不再出现 `NEXT_PUBLIC_API_URL`，杜绝绕过代理的调用。

代价：多一跳，需要保证代理层正确透传 `Cookie`、`Set-Cookie`、`X-Forwarded-*`。

### 方案 B：跨站 Cookie

Cookie 设置 `Domain=.example.com; SameSite=None; Secure`，API 侧 CORS 必须
`credentials: true` 且 `origin` 精确白名单（不能用 `*`）。
`SameSite=None` 意味着 CSRF 防护全部失效，必须补 **双提交 Token**：
服务端下发非 HttpOnly 的 `csrf_token`，前端读出来放进 `X-CSRF-Token`，
服务端比对 Cookie 与 Header 是否一致。所有写操作（POST/PUT/PATCH/DELETE）都要校验。

只有在确实需要独立域名（第三方站点直接调 API）时才选 B。

## 4. 登录：凭证如何下发

```
浏览器 --POST /api/auth/login--> Next(server action) --POST /auth/login--> Nest
                                                                          |
                                        Set-Cookie: access_token / refresh_token
                                                                          |
浏览器 <--Set-Cookie 透传（同源时自动生效）-------------------------------- Next
```

同源代理方案下不需要任何透传代码：Nest 的 `Set-Cookie` 会原样回到浏览器。
只有跨域时才需要在 Next 里搬运，而手写 `Set-Cookie` 解析（当前 `features/auth/cookies.ts`）
非常脆弱——属性顺序、`Expires` 逗号、`Partitioned` 都可能踩坑。更稳的做法是
**API 只在 JSON 里返回 token，由 Next 用 `cookies().set()` 自己写**，
退出时用同一份属性删除，否则 `clearCookie` 清不掉。

Cookie 属性基线：

```ts
{
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',      // 同源方案；跨站方案必须是 'none'
  path: '/',
  maxAge: 15 * 60,      // refresh 为 7 天
}
```

## 5. 请求：凭证如何携带

| 发起方 | 携带方式 |
| --- | --- |
| 浏览器（同源） | 自动携带，`fetch` 无需任何配置 |
| 浏览器（跨源） | `credentials: 'include'` + CORS `credentials: true` |
| Server Component / Server Action | **不会自动携带**，必须显式转发 |
| SDK / 服务端 | `Authorization: Bearer` |

最容易踩的坑是第三种：Next 服务端的 `fetch` 不是浏览器，没有 Cookie Jar。

```ts
// 服务端组件 / server action 里调 API
const cookieStore = await cookies();
await fetch(`${process.env.API_URL}/api/orgs`, {
  headers: { cookie: cookieStore.toString() },
  cache: 'no-store',
});
```

## 6. 服务端：验证分三层

认证（你是谁）→ 授权（你能不能进这个组织）→ 数据边界（这条记录是不是你的）。
三层必须都在服务端完成，前端路由守卫只是体验优化。

### 6.1 认证：验签，不查库

```ts
const payload = this.jwtService.verify<JwtPayload>(token, {
  secret: this.configService.get('JWT_ACCESS_SECRET'),
});
request.user = payload;
```

只做签名 + `exp` 校验。access token 是**无状态**的，不要在每个请求里查用户表，
否则 JWT 就退化成了 session。代价是「改密码/踢人」不会立即生效，
需要靠短有效期（15m）+ refresh token 吊销来收敛。

### 6.2 授权：成员关系必须查库

```ts
@UseGuards(JwtAuthGuard, OrgRoleGuard)
@RequireOrgRole(ORG_ROLES.ADMIN)
```

`OrgRoleGuard` 用 `orgSlug + userId` 查 `orgMembers`，并带 `removedAt IS NULL`，
查不到返回 **404 而不是 403**（避免泄露组织是否存在）。

**角色要做层级，不能做相等判断。** 当前 `member.role !== requiredRole` 会让
admin 被 `@RequireOrgRole(DEVELOPER)` 的接口拒绝。正确做法是 rank 比较：

```ts
const ROLE_RANK = { developer: 1, admin: 2 } as const;

if (requiredRole && ROLE_RANK[member.role] < ROLE_RANK[requiredRole]) {
  throw new ForbiddenException('Insufficient permissions');
}
```

### 6.3 数据边界：查询必须带租户条件

守卫只证明「你是这个组织的成员」，不证明「这条 project 属于这个组织」。
所以 service 层必须把 `orgId` / `userId` 编进 `WHERE`，而不是先按 slug 查出来再判断：

```ts
.where(and(eq(organizations.slug, orgSlug), eq(projects.slug, projectSlug)))
```

`ProjectsService.getProjectBySlug` 已经用 `innerJoin(orgMembers)` 做了限定，这是正确姿势。
新增任何「按 id 取单条」的接口都要照此办理，否则就是 IDOR。

### 6.4 项目密钥：受众与密钥都要绑定到项目

`ProjectKeyGuard` 目前用全局 `PROJECT_JWT_SECRET` 验签，而 `project-auth` 签发用户
Token 用的是每个项目的 `authJwtSecret`。两套密钥混用会带来两个问题：

1. 任一项目密钥泄露，全平台可伪造；
2. payload 里的 `projectId` 与 URL 上的 `projectSlug` 没有交叉校验，
   A 项目的 anon key 可以拿去打 B 项目的接口。

正确做法：先按 URL 的 `projectSlug` 查出 project，用它的密钥验签，
再断言 `payload.projectId === project.id`。查库这一次开销可以按 slug 做短 TTL 缓存。

## 7. 刷新：双 Token 的正确姿势

```
access 过期 → 401 → 前端/中间件用 refresh 换新 → 重放原请求
```

当前实现有三处需要修：

**（1）refresh token 不可撤销。** 现在是无状态 JWT，签发后 7 天内永远有效，
退出登录只清了 Cookie，服务端没有任何吊销手段。
应落一张 `refresh_tokens(jti, user_id, token_hash, expires_at, revoked_at, family_id)`：
每次刷新**轮换**（旧 jti 立即作废），检测到已作废的 jti 被复用则吊销整个 family。

**（2）中间件刷新后，本次渲染仍读旧 Cookie。** `proxy.ts` 里只往 `NextResponse`
写 Cookie，但下游 Server Component 读的是**请求**上的 Cookie，于是这一跳仍然带着
过期的 access token 去请求 API，直接 401。必须同时改写请求：

```ts
const response = NextResponse.next({ request });
request.cookies.set(COOKIE_KEYS.ACCESS_TOKEN, newToken);
response.cookies.set(COOKIE_KEYS.ACCESS_TOKEN, newToken, options);
```

这也是文件里 `// ??? BUG: Refresh Error` 的根因之一。

**（3）并发刷新竞态。** 页面同时发 5 个请求，全部 401，全部去刷新；
一旦启用轮换，后 4 个会拿着已作废的 token 失败并被判为「重放」。
需要单飞（single-flight）合并刷新，或给旧 token 留 30s 宽限窗口。

## 8. 还需要补的防护

- **登录限流**：`/auth/login` 按 IP + 账号双维度限流（如 5 次/分钟），否则 bcrypt 12 也挡不住撞库。
- **退出即吊销**：`signOut` 目前只清本地 Cookie，应同时调用服务端吊销 refresh token。
- **XSS 兜底**：HttpOnly 挡不住页面内发起的请求，必须配 CSP（至少禁 inline script）。
- **中间件不持有签发密钥**：`proxy.ts` 用 `JWT_ACCESS_SECRET` 验签，意味着 web 侧也拿到了密钥。
  可接受，但更小的爆炸半径是中间件只判断 Cookie 是否存在，把验签完全交给 API。

## 9. 落地顺序

1. 加 `rewrites` 同源代理，前端移除 `NEXT_PUBLIC_API_URL`，确认 Cookie 同源生效；
2. 修 `OrgRoleGuard` 的层级比较；
3. 修中间件刷新的请求 Cookie 改写；
4. refresh token 落表 + 轮换 + 吊销；
5. `ProjectKeyGuard` 改为按项目密钥验签 + projectId 交叉校验；
6. OAuth 回调改一次性 code，去掉 URL 里的 token；
7. 登录限流 + CSP。
