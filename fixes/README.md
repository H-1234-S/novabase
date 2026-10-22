# NovaBase 代码审查记录

## 审查范围

审查基于 2026-10-22 工作区当前文件，覆盖 `apps/api/src` 的 NestJS API、Drizzle/PostgreSQL 数据访问、项目 REST API、项目认证、对象存储、Realtime、模块装配与 API 测试；并检查与这些接口直接相关的 monorepo 配置和共享类型/常量。重点跟踪控制器 → Guard → Service → SQL/第三方服务的执行链。没有运行代码、迁移或测试；未修改业务代码。工作区原有未提交改动和 `docs/table-editor/` 均保留。

本次未全面审查 Next.js 视图交互、UI 状态、部署设施、生产数据库状态及第三方服务账户配置；这些属于后续范围。DTO/全局 ValidationPipe、schema 与现有 API 测试也纳入了检查。

## 项目结构与模块依赖

- `apps/api`：NestJS API；`main.ts` 配置 cookie、全局 DTO 校验、CORS、Swagger 与出站代理。
- `apps/api/src/auth`：用户 JWT Cookie 登录注册及认证 Guard；组织权限由 `OrgRoleGuard` 查询成员关系。
- `orgs`、`members`、`projects`：组织、成员邀请/角色、项目及项目 schema/key 配置。
- `table-editor`、`sql-editor`：项目数据库元数据、DDL/DML 编辑和 SQL 历史。
- `project-api`：用项目 JWT key 对外开放行查询与写操作。
- `project-auth`：项目级终端用户注册、登录、邮件链接及 OAuth。
- `storage`：控制台管理端和项目 API 两种入口，共用 UploadThing 与 storage 元数据表。
- `realtime`：控制台 HTTP 开关管理 DB trigger；Socket.IO gateway 按订阅建立 PostgreSQL LISTEN 并广播变更。
- `db` 与 `packages/{types,constants}`：共享数据库 schema、类型和协议常量；`apps/web` 的 server helpers/actions 消费 API。

典型信任链：浏览器管理请求 → `JwtAuthGuard` → `OrgRoleGuard` → controller/service；公开项目 SDK 请求 → `ProjectKeyGuard` → projectId/slug 校验 → 项目 schema SQL；Realtime 则以项目 key 握手，之后客户端直接提交订阅表名。

## 模块清单与问题统计

| 模块目录 | 问题编号 | 数量 |
|---|---|---:|
| `auth/` | AUTH-001 ～ AUTH-002 | 2 |
| `members/` | MEMBER-001 ～ MEMBER-004 | 4 |
| `projects/` | PROJECT-001 | 1 |
| `database/` | DB-001 ～ DB-003 | 3 |
| `project-api/` | API-001 ～ API-002 | 2 |
| `project-auth/` | PAUTH-001 ～ PAUTH-002 | 2 |
| `storage/` | STORAGE-001 ～ STORAGE-002 | 2 |
| `realtime/` | RT-001 ～ RT-002 | 2 |
| `common/` | COMMON-001 | 1 |
| **总计** |  | **19** |

按优先级：**P0 0、P1 8、P2 11、P3 0**。置信度均在问题正文中逐项注明；“高度疑似”项需按说明复现后确认。

## 整体风险与修复顺序

当前最高风险集中在对象级授权没有绑定路由组织/项目、公开 anon key 能读取项目 schema 任意表（包括认证用户表）、以及 WebSocket SQL 命令使用客户端订阅名拼接。建议按以下顺序处理：

1. **P1 安全边界**：API-001、MEMBER-001、PAUTH-001、STORAGE-001、RT-001。优先添加隔离回归用例，再收紧资源归属校验/SQL 构造。
2. **P1 认证与数据完整性**：MEMBER-002、MEMBER-003、MEMBER-004；补充 OAuth state 与项目 OAuth 回调 token 传递保护（AUTH-002、PAUTH-002）。
3. **P2 可靠性和输入边界**：AUTH-001、PROJECT-001、DB-001～003、STORAGE-002、RT-002。
4. **P2/P3 工程保障**：COMMON-001；从认证/授权和租户隔离用例开始补充自动化测试，再扩展业务流程覆盖。

## 文档约定

每个问题在 `issues.md` 中给出代码证据、触发方式、根因、影响、分级和置信度；同编号的 `recommendations.md` 给出落地改法与验证步骤。跨模块问题放入最贴近的安全边界模块，底层事务、启动配置和测试覆盖问题放入 `common/`。代码位置以仓库相对路径和符号/代码语句标识，行号可随修改变化。


