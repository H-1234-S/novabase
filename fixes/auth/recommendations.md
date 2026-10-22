# 用户认证修改建议

## AUTH-001：注册/首次 OAuth 事务化

- **推荐实现**：使用 `drizzle.db.transaction(async tx => ...)` 包含用户、默认组织和管理员成员写入；OAuth 按 email 唯一键处理并发冲突，事务内确定最终用户归属。
- **涉及文件**：`apps/api/src/auth/auth.service.ts`
- **验证**：插入中途故障回滚；同邮箱并发执行只保留一套有效用户与初始组织数据。

## AUTH-002：绑定并验证 OAuth 回调

- **推荐实现**：state 使用 CSPRNG 生成，短期 HttpOnly/Secure/SameSite Cookie 或服务端 nonce 存储；回调比较并消费 state。扩展 Provider 响应类型并验证邮箱已认证；检查 `response.ok`、JSON 必需字段，失败时抛受控 `UnauthorizedException`/`BadRequestException`。
- **涉及文件**：`apps/api/src/auth/auth.service.ts`、`apps/api/src/auth/auth.controller.ts`
- **验证**：回调 state 篡改/重放、provider 错误 JSON、未认证邮箱和成功登录的集成测试。
