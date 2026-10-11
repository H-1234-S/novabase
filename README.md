# TODO

1. 实现类 vs code 打开新标签逻辑
2. 新增创建组织逻辑
3. 新增修改已有表逻辑
4. 优化组织选择界面/项目选择界面侧边栏设计缺陷
5. Storage 功能文件点击后进行预览
6. 实现 uploadthing 上传进度条

# BUG

1. Sidebar 响应式在断点 800-950 区间 Trigger 问题
2. Database 删除 All Table 则 Sidebar 依旧保持 Selected 状态
3. Neon 对空闲数据库约 5 分钟无活动就 suspend 计算，挂起时代理服务器会直接切断 WebSocket
4. Project Auth Providers Save 之后才能保存

# 部署（Vercel）

## 架构说明

生产环境浏览器只访问 web 一个域名，前端所有 API 请求走同源代理
`/api/proxy/*`，由 `apps/web/src/app/api/proxy/[...path]/route.ts` 转发到
NestJS。好处是不需要 CORS，Cookie 同源写入，`SameSite=Lax` 也能正常带上。

OAuth 登录不再由 API 直接种 Cookie（跨域时浏览器不会把 API 域的 Cookie
带给 web 域），而是：API 回调生成 60 秒有效的一次性 code → 302 回
`WEB_URL/auth/callback?code=...` → web 服务端拿 code 换 token → 在 web 域
写 httpOnly Cookie。token 全程不经过浏览器 JS。

## 环境变量

复制示例文件后填写：

- `apps/api/.env.example` → `apps/api/.env`
- `apps/web/.env.example` → `apps/web/.env`

生产环境要点：

- `API_URL`：NestJS 的**公网**地址，带 `/api` 前缀（如 `https://api.example.com/api`）
- `NEXT_PUBLIC_API_URL`：**留空**，这样前端会自动走同源 `/api/proxy`
- `NEXT_PUBLIC_WEB_URL` / `WEB_URL`：web 站点的公网地址，OAuth 回跳用
- `NEXT_PUBLIC_REALTIME_URL`：API 与 web 不同域时**必须**显式指定，
  因为 WebSocket 无法被 Route Handler 代理（默认取 `API_URL` 去掉 `/api`）
- `JWT_ACCESS_SECRET`：web 侧中间件也要用，需与 API 保持一致
- `NODE_ENV=production`（Cookie 才会带 `Secure`）

## Vercel 项目设置

仓库根的 `vercel.json` 按 **Root Directory = 仓库根目录** 配置：

```json
{
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm --filter web build",
  "outputDirectory": "apps/web/.next"
}
```

> 注意：Vercel 对 Next.js 的 Output Directory 支持有限。如果部署后发现框架
> 未被识别（只当成静态站点），把 Vercel 的 **Root Directory 改成 `apps/web`**，
> 并把 `vercel.json` 移到 `apps/web/` 下，改成：
>
> ```json
> {
>   "installCommand": "cd ../.. && pnpm install --frozen-lockfile",
>   "buildCommand": "cd ../.. && pnpm --filter web build"
> }
> ```

## OAuth 回调地址

Google / GitHub 的 OAuth App 里要填（注意是 **API 的地址**）：

```
https://<api-domain>/api/auth/google/callback
https://<api-domain>/api/auth/github/callback
```

项目级 Auth 的回调地址可以在控制台的
`Auth → URL Configuration` 页面复制。
