# 项目数据库编辑问题

## [DB-001] SQL 禁止语句检查可被注释绕过

- **优先级**：P1
- **问题类型**：安全 / 数据完整性
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts`
- **涉及位置**：`parseSingleStatement()`、`executeQuery()` 的 `blocked` 前缀检查
- **问题描述**：单语句检查用 `split(';')`，禁用规则仅检查 SQL 是否以 `DROP DATABASE`、`DROP SCHEMA`、`TRUNCATE` 开头。注释位于语句前（如 `/*x*/ DROP SCHEMA ...`）即可绕过前缀规则；分号拆分也无法区分字符串/注释中的分号。
- **触发条件**：有 SQL editor 权限的组织成员提交带注释等 SQL 语法绕过黑名单。
- **根因分析**：SQL 是复杂语法，字符串前缀不是可靠语句类型/授权控制。`txn.unsafe(statement)` 会直接执行通过文本检查的内容；search_path 不能阻止 schema 级危险操作。
- **影响范围**：可能删除项目外 schema/database 或清空表，具体取决于 DB 账号权限及 Neon SQL 执行行为。
- **修复建议**：不要把黑名单当安全边界；用受限数据库角色隔离项目，并对允许的 SQL 做 AST 解析及对象范围策略；拒绝注释绕过、事务控制和不允许的对象范围。
- **验证方式**：对注释、大小写、前置空白、字符串分号和危险 DDL 变体做策略测试；在测试 DB 验证受限角色不能触达其他 schema。
- **置信度**：高度疑似（规则绕过已确认；跨项目破坏取决于 DB 用户权限）

## [DB-002] 历史写入失败会把已执行 SQL 报告为失败

- **优先级**：P2
- **问题类型**：异常传播 / 事务语义
- **涉及文件**：`apps/api/src/sql-editor/sql-editor.service.ts`
- **涉及位置**：`executeQuery()` 中 Neon 事务完成后的 `queryHistory` insert 与整体 catch
- **问题描述**：查询事务已经提交后，代码再插入 `queryHistory`。若历史写入失败，外层 catch 返回 BadRequest，但 SQL 已执行且不会回滚。
- **触发条件**：业务查询成功，随后历史写入超时、连接失败或约束错误。
- **根因分析**：执行与审计是不同事务/客户端调用，catch 覆盖两阶段。
- **影响范围**：控制台可能重试已提交的非幂等写操作；历史缺失且响应误导。
- **修复建议**：区分 SQL 执行结果与历史记录失败；可靠审计场景使用同事务或可恢复日志；无法原子化时返回执行成功并独立报告审计失败。
- **验证方式**：模拟历史 insert 失败，检查 API 响应与目标数据变化一致，并能观测审计故障。
- **置信度**：已确认

## [DB-003] 表行分页未校验且每次都执行全表 COUNT

- **优先级**：P2
- **问题类型**：参数边界 / 性能
- **涉及文件**：`apps/api/src/table-editor/table-editor.controller.ts`、`apps/api/src/table-editor/table-editor.service.ts`
- **涉及位置**：`getTableRows()` 的 `parseInt`；SQL `LIMIT ${limit} OFFSET ${offset}` 和 `COUNT(*)`
- **问题描述**：字符串会转成 NaN，负数和超大 offset/limit 没有拒绝或上限。每次读取还并行执行精确 `COUNT(*)`，大型表会重复消耗扫描资源。
- **触发条件**：无效分页参数或大表被连续/并发翻页。
- **根因分析**：query 参数没有 DTO/数值范围验证；列表固定要求精确总数。
- **影响范围**：接口 500、昂贵查询及管理端响应变慢。
- **修复建议**：严格验证整数、limit 上限和 offset 下限；考虑游标分页或可选 count。SQL 绑定数值参数。
- **验证方式**：非法、负值、边界和超大值测试；代表性大表 `EXPLAIN (ANALYZE, BUFFERS)`。
- **置信度**：已确认
