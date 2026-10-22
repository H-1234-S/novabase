# 项目终端用户认证修改建议

## PAUTH-001：管理端操作按组织和项目联合授权

- **推荐实现**：controller 把 slug 传入 dashboard service；通过 organizations/projects join 限定项目属于目标组织，所有读写使用相同租户约束。
- **涉及文件**：`apps/api/src/project-auth/project-auth-dashboard.controller.ts`、`apps/api/src/project-auth/project-auth.service.ts`
- **验证**：跨组织读写负向测试覆盖 users、settings 和 OAuth 配置更新。

## PAUTH-002：避免在 URL 中交付可重放 access token

- **推荐实现**：callback 只返回短期一次性 code/state；由配置站点后端交换访问令牌。设置 redirect allowlist。若暂时保留现协议，收紧 TTL 和 URL/referrer 日志暴露。
- **涉及文件**：`apps/api/src/project-auth/project-auth.controller.ts`、`apps/api/src/project-auth/project-auth.service.ts`、客户端 OAuth 消费逻辑。
- **验证**：回调 query 无 bearer token，code 单次兑换且过期失效。
