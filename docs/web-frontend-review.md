# apps/web 前端工程审查

> 审查时间：2026-10-28 ｜ 范围：`apps/web/src`（99 个文件 / 9253 行）  
> 视角：以中大型团队的前端工程规范为基准，重点看**职责边界、目录约定、状态分层**

## 一、结论

功能是完整的，但**没有形成前端工程规范**。当前代码是"按页面就地生长"出来的，不是"按层设计"出来的。四个量化指标可以直接说明问题：

| 指标             | 现状                                        | 参考基线                  |
| -------------- | ----------------------------------------- | --------------------- |
| 自定义 hook 数量    | **1 个**（`use-mobile.ts`，shadcn 脚手架自带，非业务） | 每个有状态的 feature 至少 1 个 |
| 单文件 > 300 行的组件 | 4 个（743 / 702 / 685 / 543）                | 0，超过 200 行即需拆分        |
| 单文件定义多个组件      | 7 个文件（最多一个文件 8 个组件）                       | 1 文件 1 导出组件           |
| feature 目录结构   | 10 个 feature，**9 种排法**                    | 统一模板                  |
| 客户端测试          | **0**                                     | 关键交互必须有               |

一句话概括：**逻辑与视图没有分层，所以"抽 hook"这个动作从来没有发生过；目录没有模板，所以每个 feature 都长成了不同的样子。**

---

## 二、为什么没有自定义 hook（根因分析）

这不是"忘了写"，是四个原因叠加的必然结果。

### 2.1 逻辑与 JSX 在同一个文件里同步生长

状态、副作用、请求、渲染写在一起时，"这部分逻辑可以复用"这个信号永远不会出现。看 `realtime-client.tsx`（685 行）的状态清单：

```ts
const [connected, setConnected] = useState(false);
const [subscribedTables, setSubscribedTables] = useState<Set<string>>(new Set());
const [pendingTables, setPendingTables] = useState<Set<string>>(new Set());
const [subscriptionErrors, setSubscriptionErrors] = useState<Map<string,string>>(new Map());
const [events, setEvents] = useState<(RealtimeEvent & { id: string })[]>([]);
const [tableSnapshots, setTableSnapshots] = useState<Map<string, unknown[]>>(new Map());
const [snapshotSyncing, setSnapshotSyncing] = useState<Set<string>>(new Set());
const [snapshotSyncedAt, setSnapshotSyncedAt] = useState<Map<string, Date>>(new Map());
const [snapshotErrors, setSnapshotErrors] = useState<Map<string, string>>(new Map());
const [snapshotNotices, setSnapshotNotices] = useState<Map<string, string>>(new Map());
const socketRef = useRef<Socket | null>(null);
const subscribedRef = useRef<Set<string>>(new Set());
const cursorRef = useRef<Map<string, string>>(new Map());
const snapshotRequestsRef = useRef<Map<string, AbortController>>(new Map());
```

**11 个 useState + 5 个 useRef 描述的是同一个东西：一个实时订阅状态机。** 它应该是一个 `useRealtimeSubscriptions()`，对外只暴露 `{ connected, events, snapshots, subscribe, resync }`。现在的写法导致：

- 组件里有 5 个 effect 在维护这 15 份状态的一致性，任何一处漏更新就是 bug；
- 这套逻辑无法被 `/realtime` 之外的页面复用（比如未来在表编辑器里内嵌实时预览）；
- 单测无从下手——要测"断线重连后 cursor 是否重置"，得先渲染整个 685 行的页面。

### 2.2 没有数据层，就没有"数据 hook"这一层

全仓**没有 React Query / SWR / 任何请求库**，`fetch` 直接写在组件里：

```
src/features/realtime/realtime-client.tsx:136,342,401
src/features/storage/storage-client.tsx:99,118,134,151,163,174,385
src/features/sql-editor/sql-editor-client.tsx:69
src/features/project-auth/components/project-auth-providers.tsx:68
```

配套的手写样板也散在组件里——`table-editor-client.tsx` 甚至自建了一套竞态防护：

```ts
const tableFetchGenRef = useRef<Map<string, number>>(new Map());
const beginTableFetch = (tableName: string) => { /* 代际 +1 */ };
const isTableFetchStale = (tableName: string, gen: number) => { /* 比较代际 */ };
```

这是**数据层缺失的症状**，不是个别组件的写法问题。正确的做法是引入 TanStack Query（已在用 `@tanstack/react-table`，同生态零学习成本），把 `useQuery`/`useMutation` 作为数据 hook 层，组件只消费结果。这样"hook 层"是架构自带的一层，不需要靠自觉。

### 2.3 `hooks/` 目录被误用，团队对它的语义没有共识

全仓唯一的 `hooks` 目录在 feature 里，但里面放的不是 hook：

```
src/features/members/hooks/members-helpers.server.ts   ← 服务端数据获取函数，零 hook
src/features/members/data/constants.ts                 ← 常量，却叫 data
```

当一个目录名和内容完全不符时，说明**目录是照着"别人好像有这么个目录"建出来的**，不是按职责划分的。这也解释了为什么 `src/hooks/` 里只有脚手架自带的 `use-mobile.ts`——它是 shadcn 初始化时生成的遗留物，不是团队演进出来的约定。

### 2.4 缺少约束机制

- `AGENTS.md`（仓库根）只有通用编码规范，**没有任何前端分层规则**；
- ESLint 只开了 `eslint-config-next`，没有 `max-lines-per-function`、`max-lines`、`react/jsx-max-props-per-line` 这类结构约束；
- 没有 code review checklist，没有目录模板文档。

结论：**不写 hook 不会报错，所以没有人写。**

---

## 三、P0：结构性问题

### P0-1 单文件承担多个组件（7 个文件）

| 文件                                                             | 行数  | 内部组件数                                                                      |
| -------------------------------------------------------------- | --- | -------------------------------------------------------------------------- |
| `features/table-editor/components/table-editor-client.tsx`     | 743 | 4（`TableEditorClient` / `TableListPanel` / `EditorMainPanel` / `DataGrid`） |
| `features/table-editor/components/create-table-drawer.tsx`     | 543 | 8（`CreateTableDrawer` + 7 个 `Column*` 子组件）                                 |
| `features/project-auth/components/project-auth-users.tsx`      | 138 | 3                                                                          |
| `features/project-auth/components/project-auth-providers.tsx`  | 222 | 2                                                                          |
| `features/api-docs/api-docs-client.tsx`                        | 227 | 2                                                                          |
| `features/project-auth/components/project-auth-url-config.tsx` | 151 | 2                                                                          |
| `features/project-auth/components/project-auth-shell.tsx`      | 106 | 2                                                                          |

`create-table-drawer.tsx` 最能说明问题：`ColumnTypeSelect`、`ColumnDefaultInput`、`ColumnCheckbox`、`ColumnFkTableSelect`、`ColumnFkColumnInput` 这 5 个是**通用表单控件**，未来做"编辑列"、"复制表结构"都要用，但因为写死在抽屉文件里，只能复制粘贴。

你的判断是对的：**一个 tsx 应该只完成一个任务/一个 UI 单元。**

### P0-2 目录约定：10 个 feature，9 种排法

```
features/api-docs/      → api-docs-client.tsx  api-docs-helpers.server.ts      （全平铺）
features/auth/          → action.ts  client.schema.ts  constants.ts  cookies.ts  server.schema.ts  sign-out.ts
features/members/       → actions/  components/  data/  hooks/  schema/          （唯一"标准"的）
features/organization/  → action.ts  client.schema.ts  create-org-form.tsx  ...
features/project-auth/  → components/  data/  schemas/  project-auth-action.ts   （schemas 复数！）
features/projects/      → action.ts  client.schema.ts  create-project-modal.tsx  ...
features/realtime/      → realtime-client.tsx  realtime-helpers.server.ts
features/sql-editor/    → sql-editor-client.tsx  sql-editor-helpers.server.ts
features/storage/       → storage-client.tsx  storage-helpers.server.ts
features/table-editor/  → components/  action.ts  client.schema.ts  ...
```

同一件事有 3 种命名：

| 语义         | 出现过的写法                                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| 服务端 action | `action.ts`（6 处）/ `actions/action.ts`（1 处）/ `project-auth-action.ts`（1 处）      |
| 校验 schema  | `client.schema.ts`（平铺）/ `schema/client.schema.ts` / `schemas/`（目录）             |
| 组件         | `components/*.tsx`（members、project-auth、table-editor）/ 直接平铺在 feature 根（其余 7 个） |

新人要改一个功能，得先判断"这个 feature 是哪种排法"。这是纯认知税。

### P0-3 组件里直接读环境变量、直接拼 URL

`process.env.NEXT_PUBLIC_API_URL` 出现 **13 处**，而且回退值不统一：

```ts
// realtime-client.tsx:71
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
// login/page.tsx:126
href={`${process.env.NEXT_PUBLIC_API_URL}/auth/google`}   // 无回退，缺失时渲染出 "undefined/auth/google"
```

没有统一的 `env` 模块（zod 校验 + 启动即失败），也没有统一的 `http` 客户端（`src/lib/axios.ts` 只服务 5 个服务端文件，客户端全在裸 fetch）。

### P0-4 服务端边界没有守卫

9 个 `.server.ts` 文件、7 个 `'use server'` 文件，但**全仓没有一处 `import 'server-only'`**。

`.server.ts` 这个后缀在 Next.js 里**没有任何语义**（那是 Vite/Remix 的约定）。也就是说：一个客户端组件误引 `organization-helpers.server.ts`（里面 `import apiClient from '@/lib/axios'`，会带上 token 逻辑）时，构建**不会报错**，只会在运行时炸或把服务端逻辑打进 bundle。

大厂标准的写法是在每个 server 文件顶部加：

```ts
import 'server-only';
```

一旦被客户端引用，构建期直接失败。

---

## 四、P1：可维护性问题

### 4.1 useEffect 反模式

**（1）用 effect 做 prop → state 同步**（`table-editor-client.tsx:80`）

```ts
const lastProjectKeyRef = useRef(projectKey);
useEffect(() => {
  if (lastProjectKeyRef.current !== projectKey) {
    lastProjectKeyRef.current = projectKey;
    setTables(initialTables);
  }
}, [projectKey, initialTables]);
```

React 官方文档明确点名这是反模式：**重置状态用 `key`，不要用 effect**。

```tsx
// page.tsx
<TableEditorClient key={`${slug}/${projectSlug}`} ... />
```

一行 `key` 替掉 6 行 effect + 1 个 ref，并且不会有"首帧渲染旧数据"的闪烁。

**（2）用 effect 弹 toast**（`members-client.tsx:48`）

```ts
useEffect(() => {
  if (state.error) toast.error(state.error, { id: 'invite-form' });
  if (state.success) toast.success(state.success, { id: 'invite-form' });
}, [state.error, state.success]);
```

`useActionState` 的返回值应该是"渲染用"的，副作用（toast）应放在 action 的封装层或提交回调里。现在这种写法在组件重挂载时会重放一次 toast。

### 4.2 路由层缺少错误与加载边界

`src/app` 下 **0 个 `error.tsx`、0 个 `loading.tsx`、0 个 `not-found.tsx`**。

这意味着任何一个 server component 抛错（`retrieveTokenFromCookie` 里的 `redirect` 之外，比如 API 500），用户看到的是 Next 默认错误页；任何一次慢查询，页面白屏无反馈。对于一个有 6 个数据面板的控制台，这是明显的体验缺口。

### 4.3 空目录残留

```
src/app/api/auth/callback/      ← 空
src/app/api/proxy/[...path]/    ← 空
```

`route.ts` 被删了，目录还在。Next 会把它们当成无效路由段，属于噪声。

### 4.4 页面层职责不均

| 页面                      | 行数    | 问题                   |
| ----------------------- | ----- | -------------------- |
| `app/login/page.tsx`    | 181   | 表单、校验、第三方登录按钮全在页面里   |
| `app/register/page.tsx` | 201   | 同上，且与 login 高度重复     |
| 其余 6 个页面                | 12–62 | 良好（只做参数解析 + 取数 + 装配） |

`login` / `register` 应该拆成 `features/auth/components/login-form.tsx` + 薄页面。两者现在重复了约 120 行（表单结构 + OAuth 按钮 + 错误展示）。

### 4.5 没有模块公共出口

- 全仓 **0 个 `index.ts`**；
- 7 处跨 feature 导入直接穿透到内部目录：

```
@/features/members/components/members-client
@/features/members/hooks/members-helpers.server     ← 从 "hooks" 里导 server helper
@/features/project-auth/components/project-auth-shell
```

feature 没有公共出口，意味着**任何内部文件重命名都是破坏性变更**，且无法通过 `index.ts` 控制"哪些是公开 API"。

### 4.6 命名不一致

| 位置                                                 | 问题                                                        |
| -------------------------------------------------- | --------------------------------------------------------- |
| `src/lib/utils.ts` vs `src/server-utils/utils.ts`  | 同名不同层，后者实际是 auth guard（`retrieveTokenFromCookie`），不是 util |
| `features/members/data/constants.ts`               | 目录叫 data，内容是常量                                            |
| `features/members/hooks/members-helpers.server.ts` | 目录叫 hooks，内容是 server 取数                                   |
| `*‑client.tsx`                                     | 有的在 `components/`，有的在 feature 根，语义上其实是"页面级容器"             |

### 4.7 零测试

`apps/web` 下 0 个测试文件，且 `package.json` 没有 `test` 脚本。上面 4 个超大组件、5 个手写状态机，全部无保护。

---

## 五、目标目录规范（建议按此收敛）

### 5.1 目录树

```
src/
├── app/                          # 只做路由与装配，page ≤ 60 行
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── error.tsx             # 必须有
│   │   ├── loading.tsx           # 必须有
│   │   └── organizations/...
│   ├── layout.tsx
│   └── globals.css
│
├── features/<domain>/            # 按业务域切分，10 个 feature 同一模板
│   ├── api/                      # 数据访问：*.server.ts（server action / 取数）
│   ├── components/               # 视图：1 文件 1 导出组件
│   ├── hooks/                    # 客户端状态与副作用：use-*.ts
│   ├── schema/                   # zod 校验
│   ├── constants.ts
│   ├── types.ts
│   └── index.ts                  # 唯一公共出口
│
├── components/
│   ├── ui/                       # 无业务基础组件（shadcn）
│   ├── layout/                   # app-sidebar / top-nav
│   └── shared/                   # 跨 feature 复用的业务组件
│
├── hooks/                        # 真正跨域复用的 hook（use-media-query 等）
├── lib/
│   ├── env.ts                    # zod 校验环境变量，启动即失败
│   ├── http.ts                   # 统一 fetch 封装（客户端）
│   ├── api-client.ts             # 统一 axios 实例（服务端）
│   └── utils.ts                  # cn 等纯函数
└── types/
```

### 5.2 硬性规则（建议写进 `apps/web/AGENTS.md`）

1. **一个 tsx 只导出一个组件**，私有子组件超过 2 个或文件超过 200 行必须拆分。
2. **组件内禁止直接 `fetch` / `axios`**，一律走 `features/*/api` 或 `features/*/hooks`。
3. **禁止在组件内读 `process.env`**，统一从 `lib/env.ts` 取。
4. **所有 server 文件首行 `import 'server-only'`**，`.server.ts` 后缀仅作可读性。
5. **跨 feature 只允许从 `index.ts` 导入**，禁止穿透 `components/`、`hooks/`。
6. **禁止用 `useEffect` 同步 prop → state**，用 `key` 重置；副作用放在 action / 事件回调。
7. **每个路由段必须有 `error.tsx` + `loading.tsx`**。
8. 有状态的 feature 必须提供 hook，组件只负责渲染。


## 七、落地顺序

| 阶段 | 动作                                                                        | 收益                                  |
| -- | ------------------------------------------------------------------------- | ----------------------------------- |
| 1  | 建 `lib/env.ts` + `lib/http.ts`，替换 13 处 env 直读和 12 处裸 fetch                | 消除"undefined/auth/google"类问题，为数据层铺路 |
| 2  | 引入 TanStack Query，先改造 storage / table-editor 两个数据面板                       | 删掉手写竞态防护，组件瘦身 30%                   |
| 3  | 按模板统一 10 个 feature 目录（先 members 作样板，再批量迁）                                 | 消除认知税                               |
| 4  | 抽 `useRealtimeSubscriptions` / `useTableTabs` / `useStorage`              | 逻辑可测、可复用                            |
| 5  | 拆 4 个超大组件，补 `error.tsx` / `loading.tsx`                                   | 可维护性 + 体验                           |
| 6  | 加 ESLint 结构约束（`max-lines` / `max-lines-per-function`）+ 前端规范写入 `AGENTS.md` | 防回退                                 |
| 7  | 补关键交互测试（Vitest + Testing Library），先覆盖 hooks                               | 有保护网后再重构                            |

---

## 附：本次审查的量化依据

| 结论                          | 命令 / 证据                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------ |
| 仅 1 个 hook                  | `find src -name "use-*.ts*"` → `src/hooks/use-mobile.ts`（shadcn 自带）                  |
| 11 useState 集中在单组件          | `realtime-client.tsx:83-107`                                                         |
| 7 个文件多组件                    | `grep -cE "^(export )?function [A-Z]"` 逐个统计                                          |
| 10 feature 9 种排法            | `for d in src/features/*/; do ls $d; done`                                           |
| 0 个 `server-only`           | `grep -rn "server-only" src` → 无命中                                                   |
| 0 个 error/loading/not-found | `find src/app -name "error.tsx" -o -name "loading.tsx" -o -name "not-found.tsx"` → 空 |
| 13 处 env 直读                 | `grep -rn "NEXT_PUBLIC_API_URL" src \| wc -l` → 13                                   |
| 0 个 barrel                  | `find src -name "index.ts"` → 0                                                      |
| 0 测试                        | `find src -name "*.test.*" -o -name "*.spec.*"` → 0                                  |
