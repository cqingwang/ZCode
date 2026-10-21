# 工程记忆 (Engineering Memory)

本文件记录 ZCode 仓库中已确认根因、具有复发风险或复用价值的工程结论。新会话遇到相似症状时，先用错误文本、工具名、模块名与根因关键词检索本文件，复用前核对适用版本并执行条目中的验证命令。

---

## EM-2026-10-21-07：分组首发失败来自客户端 local 默认 Host 与持库 Host 不一致

- **日期**：2026-10-21
- **作用域**：`packages/services/src/task-groups/`、`packages/services/src/node.ts`
- **适用版本**：官方 `offical/main` 3.16.2（`3c5b2276`）；Node 24.14.0

### 症状 / 原始错误

在 Web 的“按分组”视图选择分组后新建任务并发送消息，消息实际发送成功，但界面提示
“分组操作失败，请重试”。服务日志出现：

```text
task-groups.admit FAIL ZodError: task-group.host-identity-mismatch
task-groups.admit FAIL Error: project.host-offline
```

### 触发条件

- 通过 Web 直连独立 Server，持库 Host 为 `remote:server:<id>`；
- 任务索引中的历史任务 `workspace_identity` 为空；
- 前端新建任务提交分组时没有 `workspaceIdentity`，按现有规则默认 `hostId: "local"`；
- 侧栏批量登记把无 identity 的任务以持库 Host 发出，但校验仍按 identity 推导 `local`。

### 根因

分组服务把“没有 workspaceIdentity”等同于 `local`，而独立 Server 的项目仓储 owner 是
`remote:server:<id>`。于是同一份默认工作区任务出现两种身份：

- 新建 placement 以 `hostId: "local"` 进入 `readTree`，被 `project.host-offline` 拒绝；
- 批量登记以 `hostId: "remote:server:<id>"` 进入 Zod refine，被推导出的 `local` 拒绝。

消息发送链路在分组提交之前完成，因此组织失败只弹 toast，不回滚已经发送的消息。

### 最终修复

1. `createTaskGroupService` 注入持库 `ownerHostId`。
2. 仅当引用没有 `workspaceIdentity` 且 `hostId === "local"` 时，把 Host 归一为持库 Host。
3. 显式 `workspaceIdentity` 仍必须与 `hostId` 一致；真实其他 Host 的引用不被改写。
4. 无 identity 的引用只允许指向持库 Host，不放宽跨 Host 校验。
5. `admit` 的 tasks/placement 与 `move` 的 node/anchor 共用同一归一化与校验路径。

### 回归测试路径与命令

```bash
pnpm exec vitest run packages/services/src/task-groups/contract.test.ts
pnpm typecheck
pnpm lint
pnpm architecture:check --changed --base offical/main
```

修复前新增用例 2 个失败（`local` 未归一、持库 Host 无 identity 被拒绝），修复后 14/14 通过。

### 已排除方案

- 只在前端补 `workspaceIdentity`：历史行本身没有 identity，且不同连接方式仍会漂移。
- 放宽为任意 `hostId` 都接受：会破坏真实跨 Host 隔离，并让离线 Host 误路由到持库 Host。
- 在 `resolveTasks` 里吞掉 `project.host-offline`：会把能力/路由错误变成静默成功。

---

## EM-2026-10-21-06：Web 端归档失败来自惰性 window-controller 代理

- **日期**：2026-10-21
- **作用域**：`packages/client/src/remoteServiceAccess.ts`、`packages/client/src/websocket.ts`、`packages/client/src/messageport.ts`、`packages/desktop/src/renderer/src/main.tsx`、`packages/web/src/web-remote-control/app/webRemoteControlWorkspaceBridgeSession.ts`
- **适用版本**：官方 `offical/main` 3.16.2（`3c5b2276`）；Node 24.14.0

### 症状 / 原始错误

Web 服务中任意聊天点击“归档”，界面提示“归档任务失败”，服务日志出现：

```text
Unknown channel: window-controller
```

### 触发条件

- 通过 Web `connectViaWebSocket` 连接独立 Server；
- `RemoteServiceAccess` 无条件构造了 `windowControllerService` 的惰性 ProxyChannel；
- 侧栏 `mutateProjectTask` 看到 controller 存在，优先走 `controller.mutateTask`，而独立 Server 没有注册 `window-controller` channel。

### 根因

ProxyChannel 是惰性的：属性存在不代表 Host 提供该能力。独立 Server 只注册任务服务，不注册窗口 Host 聚合面；Web 客户端却按桌面窗口能力优先路由，导致所有归档/置顶等组织写入在首次 RPC 时失败。

### 最终修复

1. `RemoteServiceAccess` 的 `windowControllerService` 改为可选，仅在显式声明能力时构造。
2. 桌面 renderer 连接窗口 Host 时传 `windowControllerService: true`；桌面 Host 始终注册该 channel。
3. Web 直连独立 Server 不声明该能力，`mutateProjectTask` 自动回落到 `zcodeTaskService.archiveTask`。
4. 手机远控 bridge 仅在 Host 声明 `windowProjectDirectory` 时同时启用窗口 controller。

### 回归测试路径与命令

```bash
pnpm exec vitest run \
  packages/client/test/remoteServiceAccess.test.ts \
  packages/ui/test/archiveManagement.test.ts
```

### 已排除方案

- 在独立 Server 注册空的 `window-controller`：会伪造窗口能力，并让 controller 路由继续覆盖任务服务。
- 在 `mutateProjectTask` 里按错误文本降级：把能力发现失败变成运行时兜底，无法阻止其它 controller RPC 继续误路由。

---

## EM-2026-10-21-05：远端无项目会话统一落到默认工作区

- **日期**：2026-10-21
- **作用域**：`packages/services/src/node.ts`、`packages/services/src/project/`、`packages/services/src/project-storage/`
- **适用版本**：官方 `offical/main` 3.16.2（`3c5b2276`）；Node 24.14.0

### 症状 / 原始错误

在 Web 服务中选择“不在项目中工作”后发送消息，前端提示“发送失败，请稍后重试”，服务日志返回：

```text
zcode-agent.sendConversationCommandV4 FAIL
Error: project.remote-project-required
```

### 触发条件

- `projectStorageHostId` 非 `local`，即当前服务是远端持库 Host；
- 会话没有 `projectId`，UI 以 `workspacePurpose=conversation` 进入默认工作区；
- 首次创建或恢复该会话时走到 `reserveCreatedTask`。

### 根因

远端 Host 的单 root 约束要求每个会话必须归属项目，但“不在项目中工作”只把 cwd 指向 `~/.zcode/workspace/default`，没有写入项目归属；因此 `prepareSessionCreation` 仍以 `projectId=null` 落库，被 `assertRemoteTaskDirectories` 拒绝。

另一个入口是 Web 首屏：`/api/server-info` 在未设置 `ZCODE_SERVER_WORKSPACE` 时把
`process.cwd()` 当作初始 workspace。systemd 的 `WorkingDirectory` 是
`packages/server`，因此首屏直接发送会落到代码目录而不是默认工作区，同样触发
`project.remote-project-required`。

### 最终修复

1. `prepareSession()` 在远端无项目时幂等创建/复用 root 固定为 `~/.zcode/workspace/default` 的普通默认项目，但仍返回 `projectId=null`，保持 UI 的“不在项目中工作”语义。
2. `prepareSessionCreation` 仅在 cwd 等于默认工作区时把 `projectId` 解析为默认项目，再走原有 `reserveCreatedTask`；其他无项目路径继续拒绝。
3. 历史无归属的默认工作区任务复用既有 `moveTask()` 补归属，不改 CLI 事实、cwd、执行目录、归档/置顶/未读。
4. 不放宽远端单 root、cwd 归属和附加目录约束。
5. `zcode.service` 保持 `WorkingDirectory=/mnt/fs/ZCode/packages/server`，并显式设置
   `ZCODE_SERVER_WORKSPACE=/home/chan/.zcode/workspace/default`，让 Web 首屏和
   “不在项目中工作”共用同一个默认工作区。

### 回归测试路径与命令

```bash
pnpm exec vitest run \
  packages/services/src/project/preparation-race/contract.test.ts \
  packages/services/src/project/contract.test.ts \
  packages/services/src/project-storage/remote-single-root/contract.test.ts \
  packages/services/src/project-storage/repository/contract.test.ts \
  packages/services/src/project-storage/default-workspace/contract.test.ts
```

### 已排除方案

- 放宽 `assertRemoteTaskDirectories` 允许无归属会话：会破坏远端单 root 和跨 Host 归属约束。
- 为默认工作区单独分配 `draft-*` 目录：cwd 不在项目 root 内，仍会被远端约束拒绝。

---

## EM-2026-10-21-04：以官方 main 为基线维护本地侧栏增强

- **日期**：2026-10-21
- **作用域**：`packages/ui/src/workspace-sidebar-extensions/`、`packages/ui/src/app-shell/WorkspaceShellLayout.tsx`、`packages/ui/src/hooks/useAppPanels.ts`、`packages/ui/src/DesktopTopOverlay.tsx`
- **适用版本**：官方 `offical/main` 3.16.2（`3c5b2276`）；Node 24.14.0

### 症状 / 原始错误

在 `main` 上直接合并官方更新时，本地侧栏收起/展开实现与官方布局文件反复产生内容冲突，合并成本持续升高。

### 触发条件

本地功能直接改在上游高频演进的大文件里，且 `main` 同时承载官方同步与本地增量。

### 根因

`main` 既作为官方镜像又作为本地功能分支，官方每次同步都会与本地内联改动在同一区域竞争；缺少稳定的本地发布基线。

### 最终修复

1. 从 `offical/main` 切出长期分支 `release/deploy`，只承载本地发布增量。
2. 侧栏增强实现全部下沉到 managed 模块 `packages/ui/src/workspace-sidebar-extensions/`；上游文件只保留 import、hook 调用、交互层挂载和可选 `className` 透传。
3. `architecture-policy.yaml` 登记该模块，`pnpm architecture:check --changed` 保持 0 违规。
4. 部署仍以本地仓库为唯一源：`deploy.sh` 校验 systemd `WorkingDirectory` 后全量重建 CLI/Agent、后端与 Web，并重启 `zcode.service`。

### 回归测试路径与命令

```bash
pnpm typecheck
pnpm lint
pnpm architecture:check --changed
pnpm exec vitest run \
  packages/ui/test/workspaceSidebarCollapse.test.ts \
  packages/ui/src/workspace-sidebar-extensions/contract.test.ts \
  packages/ui/test/useAppPanelsScope.test.ts \
  packages/ui/test/workspaceShellRemoteMobileLayout.test.ts
ZCODE_E2E_CHROME=/usr/bin/google-chrome node packages/ui/test/workspaceSidebarCollapse.e2e.mjs
```

### 已排除方案

- 继续在 `main` 上内联本地 UI 改动：每次官方同步都会重复冲突。
- 把本地功能拆成多个上游文件补丁：挂载点分散，仍会随上游布局调整漂移。
