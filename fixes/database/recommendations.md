# 项目数据库编辑修改建议

## DB-001：使用权限隔离与 SQL 语法策略

- **推荐实现**：把 SQL editor 能力实现为授权策略；数据库用户只拥有必要项目权限。使用 PostgreSQL 兼容 parser/AST 做语句数和对象范围检查，不继续扩展字符串黑名单。
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts`、数据库角色/部署配置。
- **验证**：注释绕过、危险语句及跨 schema 访问负向集成测试。

## DB-002：拆分执行失败和审计失败

- **推荐实现**：明确响应表示 SQL 执行结果；审计失败独立记录并监控。若审计必须原子一致，设计同连接事务并验证 Neon HTTP driver 支持情况。
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts`
- **验证**：查询成功 + 历史失败、查询失败、两者成功三种场景。

## DB-003：限制分页成本

- **推荐实现**：增加 query DTO/pipe 做整数和范围校验，将值作为 SQL 参数；精确 count 改为可选或采用游标分页。
- **涉及文件**：`apps/api/src/table-editor/table-editor.controller.ts`、`apps/api/src/table-editor/table-editor.service.ts`
- **验证**：边界测试和大表查询计划对比。
