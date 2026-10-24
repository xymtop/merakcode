# MerakCode 业务小程序开发规范

本文约定新增内置业务小程序（以下简称 App）时必须遵守的结构。App 是面向用户和智能体的业务模块，例如话题讨论、待办、日程和群管理。

## 1. 核心原则

一个 App 必须由四层组成：

```text
桌面 UI ──────► 统一业务 API ─────┐
                                ├─► 数据与业务规则
智能体 ─► MCP Tool ─────────────┘
                                │
                                └─► App 事件 → 智能体任务/收件箱
```

- UI 和智能体必须调用同一套业务服务。
- UI 不得保存独立业务状态，也不得直接操作数据文件。
- 智能体能力必须通过 MCP 暴露；原生 Tool 不能作为 App 的替代接口。
- Skill 只描述复杂工作流和使用策略，不能代替 MCP Tool。
- App 必须能在没有 UI 的情况下通过 API 和 MCP 被智能体使用。

## 2. 目录结构

新 App 建议使用以下结构：

```text
packages/engine/src/<app>/
  <app>.ts                 数据模型、业务规则、事件、后台任务
packages/engine/src/server/routes/
  <app>.ts                 HTTP 路由和 Zod 输入校验
packages/engine/src/mcp/
  apps.ts                  内置 App 的 MCP Tool 注册
apps/desktop/renderer/src/features/<app>/
  page.tsx                 页面和交互
  create.tsx               创建流程（按需）
packages/engine/test/<app>/
  <app>.test.ts            业务服务和后台任务测试
```

内置 App 的完整参考实现：

- 话题讨论：`packages/engine/src/topic/topic.ts`、`apps/desktop/renderer/src/features/topic/`
- 待办：`packages/engine/src/task/task.ts`、`apps/desktop/renderer/src/features/task/`
- 动态时间线：`packages/engine/src/activity/activity.ts`、`apps/desktop/renderer/src/features/coworker/activity.tsx`

App 的 HTTP 路由位于 `packages/engine/src/server/routes/`，MCP 工具统一注册在 `packages/engine/src/mcp/apps.ts`。

## 3. 业务层

业务层必须负责：

- Zod 数据 schema。
- 持久化和数据迁移。
- 创建、查询、修改等业务规则。
- 操作者身份和参与者权限校验。
- 领域事件。
- 后台任务和重试状态。

持久化数据使用 App 自己的 Storage key 前缀：

```ts
const key = (id: string) => ["<app>", id]
```

不要把 App 数据硬塞进普通会话的 `metadata`。会话只用于对话；论坛、待办等结构化数据必须有自己的模型。

## 4. HTTP 与 SDK

每个 App 至少提供：

- `list`
- `get`
- `create`
- App 自己需要的核心操作

路由必须：

- 在 `packages/engine/src/server/server.ts` 中注册。
- 使用 `validator()` 和 Zod 校验输入。
- 使用 `describeRoute()` 声明稳定的 `operationId`，例如 `topic.comment`。
- 返回用户可理解的错误。

新增或修改路由后必须运行：

```bash
pnpm generate:sdk
pnpm generate:sdk-reference
pnpm check:api --write
```

桌面端只能通过生成的 SDK 调用 App API，不能自行使用 `fetch`。

## 5. MCP 接入

所有智能体可用的 App 能力必须通过 MCP 提供。当前内置 App 统一注册在：

`packages/engine/src/mcp/apps.ts`

MCP Server 名称固定为 `merak-apps`。工具命名规则：

```text
<app>_<action>
```

例如：

```text
topic_list
topic_read
topic_create
topic_comment
```

规则：

- 查询型工具必须标记 `readOnlyHint: true`。
- 写入工具必须校验调用者是否为合法参与者。
- 工具说明只写英文。
- 不要再为同一个 App 新增一套原生 Tool；MCP 是智能体接口的唯一入口。
- MCP Tool 必须调用业务层，不得复制业务逻辑。

### 调用者身份

MCP 调用由引擎注入调用者元数据：

```json
{
  "_meta": {
    "merakcode/actor": {
      "type": "agent",
      "id": "linche"
    }
  }
}
```

MCP Tool 必须从 `extra._meta` 读取身份，不能接受模型自行填写的 `agentID` 作为授权依据。

## 6. 事件、任务和智能体回复

数据变化后必须发布领域事件：

```ts
BusEvent.define("topic.updated", z.object({ topicID: z.string() }))
```

事件用于：

- 刷新 UI。
- 计算需要处理的智能体。
- 创建持久化任务。

对于需要模型回复的 App 操作：

1. 在一个事务中写入业务数据和待处理任务。
2. 发布领域事件。
3. 后台 worker 领取任务并调用对应智能体。
4. 将结果写回业务数据。
5. 再次发布领域事件。

任务至少要记录：

- 任务 ID
- App 和资源 ID
- 目标智能体 ID
- 来源评论/事件 ID
- 状态：`pending | running | error`
- 创建时间

必须防止智能体循环触发的 App 还要设置最大回复深度、单次回复上限，并禁止智能体响应自己的 `@`。

### 动态时间线

智能体动态是跨 App 的只读时间线，不另建一套业务状态。它由以下来源聚合：

- App 写入的动态事件，例如收到话题邀请、分配待办、提到某个智能体。
- 智能体私聊中收到的用户消息和自己的回复。
- 智能体执行过的工具动作。

新增 App 在产生“智能体收到”或“智能体执行”的事实后，调用 `Activity.record()` 或
`Activity.recordMany()`。事件需要带 `coworkerID`、方向、类型、标题和可选资源引用，并发布
`activity.updated` 以便桌面端刷新。不要把用于 UI 展示的时间线当作业务真相；业务真相仍由各 App
自己的数据模型保存。

## 7. 权限

每个写入操作必须校验：

- 调用者是用户还是智能体。
- 调用者是否属于该话题、项目或资源。
- App 能力是否被授予。
- 是否命中审批、限额或只读规则。

桌面 UI 不得作为唯一权限边界。直接调用 HTTP 或 MCP 时，业务层仍必须拒绝越权操作。

## 8. 桌面 UI

桌面页面负责展示和交互，不负责业务规则。

新 App 接入时需要：

- 在 `lib/route.ts` 增加路由构造函数。
- 在 `app.tsx` 注册 `/:dir/<app>/:id?` 路由。
- 在 `PrimaryNav` 增加菜单项。菜单顺序为“会话、通讯录、App、设置”。
- 在 `i18n/zh.ts` 和 `i18n/en.ts` 同时增加文字。
- 使用现有设计令牌和 `apps/desktop/renderer/src/styles/` 中的样式。
- 使用 `listen()` 订阅 App 事件并刷新数据。
- 不直接读写文件，不自行拼接引擎地址。

## 9. 测试要求

每个 App 合并前至少要有：

- 业务创建、查询、修改测试。
- 权限拒绝测试。
- 事件发布或任务入队测试。
- MCP `listTools` 和代表性工具调用测试。
- 需要智能体回复时，用本地假模型测试完整回写流程。
- 桌面端相关交互测试。

最后运行：

```bash
pnpm check
cd apps/desktop/renderer && pnpm test
cd packages/engine && pnpm test <相关测试>
```

## 10. 新 App 接入清单

1. 创建独立的业务数据模型。
2. 实现业务服务和操作者权限检查。
3. 添加 HTTP 路由并注册到 Server。
4. 生成 SDK、OpenAPI 和 SDK 参考文档。
5. 在 `AppMCP` 注册 MCP Tool。
6. 定义 App 领域事件。
7. 为异步智能体工作建立持久任务和 worker。
8. 添加桌面路由、菜单、页面和中英文文案。
9. 编写业务、MCP、UI 测试。
10. 运行完整的 `pnpm check`。
