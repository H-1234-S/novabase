# 项目管理问题

## [PROJECT-001] 项目 schema 预配与项目记录创建不是原子流程

- **优先级**：P2
- **问题类型**：资源一致性 / 异常处理
- **涉及文件**：`apps/api/src/projects/projects.service.ts`
- **涉及位置**：`createProject()`、`provisionSchema()`
- **问题描述**：先执行 `CREATE SCHEMA`，随后插入项目，再更新两把 JWT key。后续任何步骤失败都会留下孤立 schema 或 key 为空的项目。
- **触发条件**：插入/更新失败、服务重启或数据库连接在步骤间断开。
- **根因分析**：schema DDL 与元数据表写入分开执行，没有事务或补偿清理。
- **影响范围**：数据库孤儿 namespace、控制台不可见资源，或缺少可用 key 的项目。
- **修复建议**：确认 Neon HTTP 对此事务流程的支持后，把 schema 与项目初始 key 写入纳入原子流程；否则采用 provisioning 状态与失败补偿。key 可在 insert 前生成。
- **验证方式**：在 schema 创建、项目插入和 key 写入阶段注入失败，验证无孤儿资源或留下可恢复状态。
- **置信度**：已确认
