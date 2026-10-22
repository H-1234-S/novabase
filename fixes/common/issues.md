# 通用工程问题

## [COMMON-001] 自动化测试未覆盖核心业务模块与安全边界

- **优先级**：P2
- **问题类型**：测试覆盖 / 回归风险
- **涉及文件**：`apps/api/src/app.controller.spec.ts`、`apps/api/vitest.config.ts`、`apps/api/vitest.config.e2e.ts`
- **涉及位置**：唯一 spec 仅检查 `AppController.health()`；e2e 配置只包含 `*.e2e-spec.ts`，当前仓库未发现此类测试
- **问题描述**：认证、组织隔离、项目 key、数据库编辑、存储、Realtime、邀请和项目认证均无自动化测试保护；授权错误和并发竞态缺乏回归检测。
- **触发条件**：模块改动或权限策略调整。
- **根因分析**：测试配置存在，但覆盖只有 health endpoint 的单元用例；没有授权矩阵或隔离集成测试。
- **影响范围**：本审查列出的 P1 问题及未来修复容易回归；部署前难以验证跨租户边界。
- **修复建议**：先加基于隔离测试 DB/mock 的 service 和 HTTP 集成测试，覆盖 anon/developer/admin 以及跨组织、跨项目资源访问；再测试并发管理员变更和外部副作用失败。
- **验证方式**：API test/e2e 命令运行关键授权用例；测试数据和环境隔离，并在 CI 执行。
- **置信度**：已确认
