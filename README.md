# Novabase

轻量级 BaaS 平台：Postgres 数据库、实时订阅、对象存储与身份认证。

## 仓库结构

```
apps/
  api/                 NestJS 服务端（Postgres + Drizzle、Socket.IO 实时、认证）
  web/                 Next.js 控制台（App Router、React 19）
packages/
  constants/           内部共享常量（源码包，私有）
  types/               内部共享类型契约（源码包，私有）
  novabase/            对外发布的 JavaScript SDK（@hushaoqiong/novabase）
```

`packages/` 下同时存在两类包，修改前请先确认归属：

- **内部源码包**（`@novabase/types`、`@novabase/constants`）：`private: true`，不构建，`main`/`exports` 直接指向 `src/index.ts`。被 `apps/*` 以 `workspace:*` 引用。
- **对外发布包**（`@hushaoqiong/novabase`）：走 `tsdown` 构建到 `dist/`，通过 npm 发布，**不能**依赖上面两个私有包以外的内部实现（`@novabase/constants` 会被内联进产物）。

## 环境要求

- Node >= 22.18（见 `engines`、`.nvmrc`）。低版本无法加载源码包，会在运行时崩溃。
- pnpm 12（`corepack enable` 后由根 `packageManager` 字段锁定）。

仓库只允许使用 pnpm。`npm install` / `yarn` 会被根 `preinstall` 脚本直接拦截，因为 workspace 协议与符号链接结构只有 pnpm 能正确处理。

```bash
corepack enable
pnpm install
```

## 常用命令

所有命令都在仓库根执行。

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 并行启动 api 与 web |
| `pnpm dev:api` / `pnpm dev:web` | 单独启动 |
| `pnpm build` | 按依赖拓扑顺序构建所有包 |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm lint` | 全仓 lint |
| `pnpm test` | 全仓单测 |
| `pnpm format` / `pnpm format:check` | Prettier 格式化 |

### 环境变量

两个应用各自维护 `.env`，模板见 `apps/api/.env.example`、`apps/web/.env.example`。`.env` 不入库。

### 数据库

```bash
pnpm --filter api run db:generate   # 生成迁移
pnpm --filter api run db:migrate    # 应用迁移
pnpm --filter api run db:push       # 开发期直接同步
pnpm --filter api run db:studio
```

> `drizzle-kit generate` 产出的迁移缺少 `IF NOT EXISTS`，对已存在的表重跑 `db:migrate` 会失败。重建库时使用 `pnpm --filter api run db:reset`。

## 依赖版本

跨包共享的依赖统一在 `pnpm-workspace.yaml` 的 `catalog:` 中声明，各 `package.json` 用 `"catalog:"` 引用。新增共享依赖时请加到 catalog，不要在单个包里写死版本。

TypeScript 编译选项的公共部分在 `tsconfig.base.json`，各包 `extends` 后只覆盖差异项。

## Lint 工具边界

仓库目前有两套 linter，边界是明确的：

- `apps/api` → **oxlint**（`oxlint src/ test/`）
- `apps/web` → **eslint**（`eslint-config-next`）

`pnpm lint` 会分发到各自包内执行。跨端改动请两个都跑。

## 测试

单测目录结构镜像源码结构（见 `AGENTS.md`）。服务端使用 Vitest，测试文件与被测文件同目录，命名为 `*.spec.ts`。

## 发布 SDK

```bash
pnpm --filter @hushaoqiong/novabase run build
pnpm --filter @hushaoqiong/novabase publish
```

`socket.io-client` 与 `uploadthing` 是 `peerDependencies`，不打进产物——避免宿主应用出现同一库的多份实例。发布前请确认 `dist/` 内的外部引用只有这两个包。
