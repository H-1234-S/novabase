# 项目管理修改建议

## PROJECT-001：使 schema provisioning 可恢复

- **推荐实现**：预先生成项目 ID、slug、schema、签名 key；在数据库事务内创建 schema 并插入完整 project row。先验证 Neon HTTP driver 对 DDL transaction 的支持。若不支持，引入 `provisioning/ready/failed` 状态及幂等补偿步骤。
- **涉及文件**：`apps/api/src/projects/projects.service.ts`，必要时 `apps/api/src/db/schema/projects.ts` 与迁移。
- **验证**：故障注入和重复请求测试，检查 schema 与项目状态最终一致。
