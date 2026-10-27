<!-- GENERAL CODING GUIDELINES START -->

# Jo's Thought Imprint

1. Fail fast and loudly: Do not write fallback logic unless it is explicitly required.
2. Let exceptions/errors bubble up early: Do not handle errors inside business layers.
3. Valid test: Prove a bug/problem exists by failing it. Only write tests that will passprove nothing.
4. Add comments to externally exposed types, interfaces, functions, and classes, and add functional comments on key logic branches.
5. Reuse utility functions from `utils` whenever possible. If a common function does not exist but can be extracted for reuse, add it to `utils` and reuse it there.
6. When writing unit tests, mirror the source code directory structure strictly. Each unit test file must only test the corresponding source file's functionality.
7. Always use source types from the owning library/module. Do not create local duplicate types or cast values to local stand-in types just to solve TypeScript issues.
8. Avoid abstraction layers that do not simplify the code or preserve a real boundary. Prefer calling the owning module/service directly over passing broad wrapper objects through layers.
9. Do not write explicit function return types unless TypeScript cannot infer them correctly or the annotation is required to preserve a public contract.
10. Do not extract one-off helper functions unless they preserve a real boundary, hide meaningful complexity, or are expected to be reused. Prefer inlining simple single-use logic.
<!-- GENERAL CODING GUIDELINES END -->

# Novabase 工程指南（AI Agent）

本文件是仓库级开发约定。修改代码前先检查工作树及目标目录内更具体的 `AGENTS.md`；保留已有用户改动，不要用格式化、生成或重置命令覆盖无关文件。本文中的架构描述依据当前仓库源码；产品策略或部署配置未由源码确定的部分会明确标成待确认。

## 1. 仓库结构与模块边界

这是由 pnpm workspace 管理的 monorepo（`pnpm-workspace.yaml`：`apps/*`、`packages/*`）。根目录 `package.json` 只提供并行开发入口；没有根级 lint、test 或 build 脚本。

| 路径                                           | 职责与入口                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/`                                    | NestJS API。启动入口 `src/main.ts`，模块组装在 `src/app.module.ts`。业务模块包括 `auth`、`orgs`、`members`、`projects`、`project-api`、`project-auth`、`table-editor`、`sql-editor`、`realtime`、`storage`。                   |
| `apps/web/`                                    | Next.js App Router 管理界面。路由在 `src/app/`，按功能拆分的服务端/客户端逻辑在 `src/features/`，请求封装在 `src/lib/axios.ts`，会话路由代理在 `src/proxy.ts`。本目录另有必须遵循的 [apps/web/AGENTS.md](apps/web/AGENTS.md)。 |
| `packages/types/`                              | API/Web 共享 TypeScript 类型。                                                                                                                                                                                                 |
| `packages/constants/`                          | 共享常量，例如 cookie 名称和项目 key 角色。                                                                                                                                                                                    |
| `packages/novabase/`                           | 对外 JavaScript SDK；修改 `src/`，发布产物由 `tsdown` 生成至 `dist/`，不要手改 `dist/`。                                                                                                                                       |
| `apps/api/src/db/schema/`、`apps/api/drizzle/` | Drizzle schema 定义与已提交 PostgreSQL migration。                                                                                                                                                                             |
| `docs/`                                        | 功能说明；`fixes/` 是代码审查及待修问题文档，不应当作实现规范或源码。                                                                                                                                                          |

API 在 `main.ts` 设置全局 `/api` 前缀、cookie parser、全局 `ValidationPipe`（`transform`、`whitelist`、`forbidNonWhitelisted`）、CORS 和 Socket.IO adapter；Swagger 挂在 `/api`。添加控制器或改变路由时同时考虑全局前缀和 Swagger 行为。`AppModule` 中 `ConfigModule` 为全局模块，`DbModule` 通过全局 `DrizzleService` 提供数据库访问。

## 2. 关键调用链与架构约束

### 管理端 API 与组织隔离

- 管理端 HTTP 认证由 `apps/api/src/auth/guards/jwt-auth.guard.ts` 从 cookie 读取 access token 并验证 `JWT_ACCESS_SECRET`；组织路由通常再由 `OrgRoleGuard` (`apps/api/src/auth/guards/org-role.guard.ts`) 按 URL 中的组织 `slug`、用户 ID 和未移除成员记录检查成员关系/角色。
- 新增组织/项目管理接口时，核对 Controller 上的 guard 与角色 decorator，并沿 service 查询确认查询同时绑定当前组织/项目和用户权限。仅有有效 JWT 不代表有权访问任意组织或项目。
- Web 的 server action 通常在 `apps/web/src/features/*/action.ts` 校验表单、读取 cookie token，再通过 `apps/web/src/lib/axios.ts` 调 API；新增动作要确认服务端校验、API 授权和缓存 revalidation 均覆盖，不能只依赖隐藏按钮或客户端校验。

### 项目 key 与租户数据

- `ProjectsService` (`apps/api/src/projects/projects.service.ts`) 创建项目记录、生成项目 schema，并签发 `anon` / `service_role` 项目 JWT；项目数据库 schema 名存于 `projects.dbSchema`。项目 key 由 `ProjectKeyGuard` 使用 `PROJECT_JWT_SECRET` 验签。
- 公共 REST 入口在 `apps/api/src/project-api/project-api.controller.ts`，查询实现为 `ProjectApiService`。其路由中的 `projectSlug` 必须与 key 内 `projectId` 对应项目匹配；新增查询必须保持项目和 schema 的绑定，避免只按可猜测的 slug 或表名查数据。
- 当前项目使用 schema 隔离；不要假设它已经具备 PostgreSQL RLS 或终端用户级行授权。`anon` 与 `service_role` 的能力应按 guard/controller 的实际判断确认。
- `ProjectApiService`、SQL editor 和 table editor 有动态 SQL/标识符场景。SQL 值优先使用参数绑定；标识符不能通过普通 bind 参数安全替换，应进行严格 allowlist/验证并用正确 identifier quoting。不要把客户端标识符直接拼进 DDL/DML。SQL editor 是特权管理能力，沿其 controller 的管理端认证和项目范围核验调用链审查。

### 数据库和迁移

- Drizzle schema 从 `apps/api/src/db/schema/index.ts` 导出；API 运行时 `DrizzleService` (`apps/api/src/db/drizzle.service.ts`) 使用 `drizzle-orm/neon-http` 和 `DATABASE_URL`。Realtime 另有长期 Neon WebSocket `Client` 生命周期，不能把其连接/事务语义等同于 HTTP Drizzle provider。
- Drizzle Kit 配置为 `apps/api/drizzle.config.ts`，读取 `DATABASE_URL`，schema 在 `src/db/schema/index.ts`，migration 输出在 `apps/api/drizzle/`。修改 schema 时检查对应 migration、现存数据兼容性、唯一/外键约束及创建/删除顺序；不要只改 TS schema 后假定数据库已同步。
- `db:generate`、`db:migrate`、`db:push`、`db:studio` 会接触目标数据库或其 schema。执行前确认目标环境、连接串来源及 migration 内容；不得对未知/生产环境运行 `db:push` 或 reset。package 声明 `db:reset` 指向 `apps/api/scripts/reset-db.ts`，但该文件当前不存在；先确认脚本状态，不能假设 reset 可用，也不能自行补建或改指向。若未来存在 reset 实现，它属于显式破坏性操作，除非任务明确授权且环境隔离已确认，否则禁止执行。
- 不输出 `.env` 内容、token、密钥或连接串。仓库忽略 `.env`；当前 API/Web 各有本地 `.env`，不要提交或读取其值。代码中实际出现的环境变量名可通过源码/配置确认，部署环境是否设置仍需环境信息验证。

### Realtime、存储和其他外部边界

- Realtime 涉及 Socket.IO 握手、项目 key、PostgreSQL `LISTEN/NOTIFY`、动态 channel、触发器及客户端重订阅，改动前必须读 [fixes/realtime/README.md](fixes/realtime/README.md) 和对应的 `execution-flow.md`、`recommendations.md`；这些是审查材料，需重新对照当前源码，不能视作已实施方案。
- Storage 由 `apps/api/src/storage/` 的 controller/service 与 UploadThing 集成。外部上传/删除与本地数据库不是天然原子事务；处理失败时检查补偿、重试和幂等性，避免宣称跨系统事务。
- 出站代理配置在 `apps/api/src/main.ts`，仅环境提供 HTTP(S)\_PROXY 时配置 Undici dispatcher，并替换全局 fetch。修改网络依赖、上传、邮件或 Neon HTTP 请求时，检查 `NO_PROXY` 和 dispatcher/fetch 版本一致性，避免改变全局出站请求行为。

## 3. 开发命令

使用 pnpm workspace 命令，不要在子应用切换 npm/yarn 锁文件。根目录 dev 命令会同时启动 API 和 Web。

| 目的         | 命令                                        | 说明                                                                                                                          |
| ------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 同时开发     | `pnpm dev`                                  | 根脚本使用 `concurrently` 启动 API watch 和 Web dev server。                                                                  |
| 单独启动 API | `pnpm dev:api`                              | 实际执行 `nest start --watch`。                                                                                               |
| 单独启动 Web | `pnpm dev:web`                              | Next dev，端口 3001。                                                                                                         |
| API 构建     | `pnpm --filter api build`                   | Nest build。                                                                                                                  |
| API 单测     | `pnpm --filter api test`                    | Vitest `**/*.spec.ts`；现有测试很少，不能据此认为业务模块覆盖充分。                                                           |
| API 覆盖率   | `pnpm --filter api test:cov`                | Vitest coverage；运行前检查本地测试配置及所需外部依赖。                                                                       |
| API E2E      | `pnpm --filter api test:e2e`                | 使用 `vitest.config.e2e.ts` 查找 `**/*.e2e-spec.ts`。当前仓库未发现 E2E spec，不要把该脚本存在等同于 E2E 覆盖存在。           |
| API lint     | `pnpm --filter api lint`                    | package 脚本是 `oxlint src/ test/`；当前文件树未发现 `apps/api/test/`，执行前确认脚本路径问题。不要悄悄把失败记成 lint 通过。 |
| Web lint     | `pnpm --filter web lint`                    | 执行 ESLint。                                                                                                                 |
| Web build    | `pnpm --filter web build`                   | Next production build。                                                                                                       |
| Web 类型检查 | `pnpm --filter web exec tsc --noEmit`       | package 没有 typecheck script；这是依据其 TypeScript 配置的直接检查命令。                                                     |
| SDK build    | `pnpm --filter @hushaoqiong/novabase build` | `tsdown` 编译 `packages/novabase/src`。                                                                                       |

API `test` / `test:e2e` / lint 脚本来自 `apps/api/package.json`，测试配置来自 `apps/api/vitest.config.ts` 与 `vitest.config.e2e.ts`。在 API 源码使用 NodeNext ESM，遵循现有相对 import 的 `.js` 后缀；Web 使用 `@/*` 指向 `apps/web/src/*`。Web 没有独立 test script，不能假设已有浏览器测试框架。

## 4. API、验证与错误处理

- 请求 DTO 使用 `class-validator` / `class-transformer`，并由全局 ValidationPipe 执行。新增 body DTO 要声明字段验证与转换；查询参数并不因全局 pipe 就自动满足业务约束，需显式解析范围、枚举、分页及格式。
- 复用 Nest HTTP 异常（如 `BadRequestException`、`NotFoundException`、`ForbiddenException`），不要捕获后返回伪成功或吞掉底层错误。对可恢复的第三方错误转换为稳定的 API 错误时保留可诊断日志，但不得记录 credential 或用户敏感数据。
- Controller 负责 HTTP/WebSocket 边界及权限入口，业务规则放 service；数据库读写集中使用现有 Drizzle provider，除非该模块有明确不同的协议需求。避免 Controller、server action 和 service 各自复制不一致的业务校验。
- 对写接口审查重复请求、部分失败、唯一约束冲突及事务边界。多步数据库写入若必须全成全败，应使用同一数据库事务；外部服务不在 PostgreSQL 事务内，需单独设计幂等/补偿。

## 5. 身份认证与安全

- 管理员 JWT 与项目 JWT 使用不同 secret（`JWT_ACCESS_SECRET` / `PROJECT_JWT_SECRET`）；不要混用 token 类型或将 secret 放入 `NEXT_PUBLIC_*`、客户端 bundle、日志、错误消息或提交内容。
- Web cookie 代理逻辑在 `apps/web/src/proxy.ts`，API cookie 验证在 auth guard。涉及刷新、退出、cookie 属性或认证路由时同时追踪 API 端 cookie 设置/清除以及 Web refresh flow；只在 UI 重定向不能撤销服务端授权。
- 对每个对象 ID 或 slug 检查授权是否在服务端完成并绑定所属组织/项目。不可依赖客户端提供的 project/org ID、隐藏控件或已验签但未授权的 key role。
- 对动态 SQL 的参数化只保护值，不保护表名、schema、列名、排序方向等标识符。标识符必须来自可信元数据或严格校验，且权限应限制数据库账号可能造成的影响；检查 SQL editor 和 realtime channel 等直接 SQL 字符串入口。
- WebSocket 事件、上传对象路径和 Storage bucket 同样是授权边界。检查连接认证、每条操作的项目归属、事件房间 key、大小/速率限制及断开清理。

## 6. Web 与共享包约定

- Web 改动先阅读 `apps/web/AGENTS.md`。Next 锁定版本为 `16.3.6`；该目录规则要求在编写 Next 代码前阅读本地 `node_modules/next/dist/docs/` 中相关指南。规则块由 Next dev 自动生成，避免误删或无意改写。
- App Router 页面尽量维持服务端与客户端边界：`'use server'` actions 位于 feature action 文件，交互 UI 位于 client component；不要将服务端 secret、仅服务端工具或 cookie token 引入 client component。
- 共享 contract 放 `packages/types` / `packages/constants`，跨 API/Web/SDK 需要同步时优先复用，避免重复定义导致 role、payload、字段名漂移。更新导出后检查所有消费者及 workspace build。
- `packages/novabase` 的 npm exports 指向 `dist/`，源码在 `src/`；变更后运行 SDK build。提交是否包含 dist 以仓库现有跟踪策略为准，先检查 git status，不直接生成/覆盖无关产物。

## 7. 测试与验证策略

- API Vitest 单测配置在 `apps/api/vitest.config.ts`，当前可见测试为 `apps/api/src/app.controller.spec.ts` 的 health controller 测试；它不验证 auth、租户隔离、SQL、迁移或 Realtime。新增/修改业务逻辑时优先在对应模块增加边界测试，特别关注未授权、跨租户、并发和失败清理路径。
- E2E 配置只筛选 `*.e2e-spec.ts`；当前未发现匹配用例。集成数据库、Socket.IO、UploadThing 或 OAuth 的验证应明确区分 mock 与隔离真实服务，避免无意访问开发者 `.env` 指向的资源。
- Web package 当前仅定义 lint/build，没有 test script。修改时至少执行目标应用适用的 lint、类型检查或 build；若无法执行，报告原因和剩余风险，不宣称已验证。
- 修改 DB schema/SQL 时，除类型检查外还要核对 migration diff 和目标 PostgreSQL 行为。修改 Realtime 时按专项审查 test plan 覆盖 mock 状态机与真实 PostgreSQL/Neon 驱动边界。
- 本仓库当前未发现 `.github/workflows/` CI 配置；不要假设本地命令之外还有自动 lint/test/build gate。

## 8. 常见陷阱

- 根 `README.md` 当前是待办清单，不是可靠的架构/接口规范；优先以源码、配置、schema、migration 和已执行测试为准。功能文档位于 `docs/`，也要和实现交叉验证。
- API `format` 脚本是写入式 `prettier --write`，不是只读检查；执行前确认目标文件是否有用户改动。API lint 目标包含当前未发现的 `test/` 目录，先核实其可运行性。
- package 当前声明的 `db:reset` 入口目标文件缺失，命令不可视为可用；不要因为脚本名或测试需要而自行补建脚本或在不明环境执行 reset。任何 migration/push/studio 命令也可能连接真实 `DATABASE_URL`。
- 项目 key 当前由源码设置为长期有效（`ProjectsService.signProjectKey`）；新增 token 逻辑时勿假设短期过期或已有自动轮换。密钥暴露应按项目 key 生命周期评估。
- PostgreSQL identifier、NOTIFY payload、transaction 与 Neon serverless driver 有各自限制；不要把 mock 的行为直接当作真实服务端语义。为驱动/协议边界使用隔离环境验证。
- 同时检查 `git status --short` 和 diff。工作区已有未提交改动时只修改任务所需文件，绝不 reset、checkout 或格式化整个目录。

## 9. 推荐任务工作流

1. `git status --short`，阅读根/目标子目录 `AGENTS.md`，确认已有改动和任务边界。
2. 从入口向下追调用链：路由/Controller 或 page/action → guard/validation → service → provider/数据库/外部服务 → 返回值、异常和清理路径；引用配置和测试核实实际行为。
3. 跨模块改动先检查共享类型/常量、调用方、租户隔离与迁移兼容；记录无法从代码确认的产品/部署假设，不擅自定为事实。
4. 做最小范围的实现；不顺手重构无关模块，不生成或覆盖锁文件、migration、编译产物，除非任务需要。
5. 运行与改动范围匹配的只读验证命令。数据库、外部网络、重置数据等操作需明确授权并确认隔离环境。
6. 汇报改了什么、验证的具体命令与结果、未验证部分及风险。失败命令如实说明，不隐藏或改写结果。

## 10. 专项指南索引

- 修改 Next/Web 代码：先读 [`apps/web/AGENTS.md`](apps/web/AGENTS.md)，并按该文件要求查阅 Next 本地版本文档。
- 修改 Realtime API、Web 客户端、SDK 订阅或触发器：读 [`fixes/realtime/README.md`](fixes/realtime/README.md)、`fixes/realtime/execution-flow.md`、`fixes/realtime/security-analysis.md`、`fixes/realtime/reliability-analysis.md`、`fixes/realtime/recommendations.md` 和 `fixes/realtime/test-plan.md`。这些是审查记录，不代表其中建议已经落地；先核实源码和问题状态。
- 修改 Table Editor：查看 `docs/table-editor/table-editor.md`，并沿 `apps/api/src/table-editor/` 与 `apps/web/src/features/table-editor/` 校验前后端行为。
- 修改 Auth、REST API：参考 `docs/auth/auth.md`、`docs/api/api.md`，并以 guards、controller 和 service 的现状为准。
