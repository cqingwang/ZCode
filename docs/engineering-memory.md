# 工程记忆 (Engineering Memory)

本文件记录 ZCode 仓库中已确认根因、具有复发风险或复用价值的工程结论。新会话遇到相似症状时，先用错误文本、工具名、模块名与根因关键词检索本文件，复用前核对适用版本并执行条目中的验证命令。

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
