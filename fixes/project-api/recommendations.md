# 项目公开 REST API 修改建议

## API-001：建立默认拒绝的表与列暴露策略

- **推荐实现**：公共 REST 仅查询显式暴露表/列；auth_users 和内部表强制 deny。使用独立 DB role/schema 做数据库层隔离；检查 anon 与 service role 是否需要不同可见范围。
- **涉及文件**：`apps/api/src/project-api/project-api.service.ts`、`apps/api/src/project-auth/project-auth.service.ts`，必要时 schema 与迁移。
- **验证**：anon key 端到端隔离测试，断言 hash 和未公开表字段不可获取。

## API-002：严格拒绝无效查询参数

- **推荐实现**：解析统一返回结构，对错误值抛 `BadRequestException`；使用明确数值范围与操作符集合，避免静默跳过。
- **涉及文件**：`apps/api/src/project-api/query-parser.ts`
- **验证**：参数解析单测与 REST 集成测试检查查询语义。
