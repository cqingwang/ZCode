# 工程记忆 (Engineering Memory)

本文件记录 ZCode 仓库中已确认根因、具有复发风险或复用价值的工程结论。新会话遇到相似症状时，先用错误文本、工具名、模块名与根因关键词检索本文件，复用前核对适用版本并执行条目中的验证命令。

---

## EM-2026-09-21-01：zcode-cli 编译与 zcode web 服务对外提供访问

- **日期**：2026-09-21
- **作用域**：`apps/zcode-cli`、`packages/server`、`packages/web`
- **适用版本**：仓库根 `package.json` version 3.14.0；CLI `@zcode/cli` 0.16.9

### 症状 / 原始错误

1. 在 `apps/zcode-cli` 子工作区内直接执行 `pnpm --dir apps/zcode-cli run build` 失败：

   ```
   > zcode-cli@0.16.9 build /mnt/fs/ZCode/apps/zcode-cli
   > turbo run build
   sh: 1: turbo: not found
    ELIFECYCLE  Command failed.
   ```

2. 默认 Node 为 v22.23.2，而 `mise.toml` / `.nvmrc` 锁定 Node 24.14.0，存在版本不一致风险。

### 触发条件

- 在 `apps/zcode-cli` 子工作区而非仓库根执行构建。
- 未按仓库锁定版本切换 Node。

### 根因

1. `apps/zcode-cli` 是**嵌套的独立 pnpm 工作区**，其 `node_modules/.bin` 中只有 `esbuild/oxfmt/oxlint/tsc/tsserver`，**不含 `turbo`**；`turbo` 仅安装在仓库根的 `node_modules/.bin/turbo`。子工作区 `package.json` 的 `build` 脚本却调用 `turbo run build`，因此从子工作区直接执行必然找不到 `turbo`。
2. 环境默认 Node 版本低于仓库锁定版本。

### 最终修复

**不要**在子工作区直接跑 `build`，改用仓库根提供的规范入口（`scripts/build-zcode.mjs` 的 `buildOutputs()` 即为此三步）：

```bash
export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 24.14.0

cd /mnt/fs/ZCode

# 1) 编译 zcode-cli 及其工作区依赖（17 个 project）
pnpm --filter "@zcode/cli..." build
# 产物：apps/zcode-cli/packages/cli/dist/zcode.cjs

# 2) 构建服务端
rm -rf packages/server/dist
pnpm --filter @zcode/server build
# 产物：packages/server/dist/entry-http.js

# 3) 构建 Web 前端
pnpm --filter @zcode/web build
# 产物：packages/web/dist/
```

**启动 Web 服务对外提供访问**（`packages/server/src/entry-http.ts` 读取的环境变量）：

```bash
cd /mnt/fs/ZCode/packages/server
PORT=3030 \
HOST=0.0.0.0 \
ZCODE_SERVER_HOST=0.0.0.0 \
ZCODE_WEB_STATIC_ROOT=/mnt/fs/ZCode/packages/web/dist \
ZCODE_SERVER_AUTH_TOKEN=<随机token> \
node dist/entry-http.js
```

- `ZCODE_WEB_STATIC_ROOT` 设置后自动启用 SPA fallback（非 `/api/`、非 `/ws` 路径回落到 `index.html`）。
- `ZCODE_SERVER_AUTH_TOKEN` 设置后 `authRequired` 生效，仅保护 `/api/*` 与 `/ws*`；静态资源不鉴权。

### 关键坑：鉴权不是 Bearer Header

`packages/server/src/http.ts` 的 `hasValidLiteToken()` **只接受两种形式**，传 `Authorization: Bearer <token>` 会返回 401：

1. 查询参数：`http://host:3030/?token=<token>` → 服务端回写 `Set-Cookie: zcode_lite_token=<token>; Path=/; HttpOnly; SameSite=Lax`
2. Cookie：`Cookie: zcode_lite_token=<token>`

正确用法是先带 `?token=` 访问一次换到 Cookie，后续请求自动携带。

### 常驻部署：systemd（zcode.service）

前台 `node dist/entry-http.js` 会随会话结束被回收，长期常驻与开机自启必须交给 systemd。

**单元文件** `/etc/systemd/system/zcode.service`（`User=chan`，系统级单元，不依赖登录会话，无需 `loginctl enable-linger`）：

```ini
[Unit]
Description=ZCode Web Service (HTTP + WebSocket)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=chan
Group=chan
WorkingDirectory=/mnt/fs/ZCode/packages/server
Environment=NODE_ENV=production
Environment=PORT=3030
Environment=HOST=0.0.0.0
Environment=ZCODE_SERVER_HOST=0.0.0.0
Environment=ZCODE_WEB_STATIC_ROOT=/mnt/fs/ZCode/packages/web/dist
EnvironmentFile=/etc/zcode/zcode.env
ExecStart=/home/chan/.nvm/versions/node/v24.14.0/bin/node dist/entry-http.js
Restart=always
RestartSec=3
TimeoutStopSec=20
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zcode
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/home/chan/.zcode /mnt/fs/ZCode

[Install]
WantedBy=multi-user.target
```

**凭据外置** `/etc/zcode/zcode.env`（`chmod 700` 目录 + `chmod 600` 文件，root 所有），内容 `ZCODE_SERVER_AUTH_TOKEN=<token>`；token 不写入单元文件，避免 `systemctl cat` 泄露。

**关键点**：

1. `ExecStart` 必须写 **node 绝对路径**。本机无 `/usr/bin/node`，Node 由 nvm 提供（`/home/chan/.nvm/versions/node/v24.14.0/bin/node`），systemd 不加载 shell profile，用 `node` 会直接失败。
2. 用**系统级**单元而非 `--user` 单元：`--user` 需要 `loginctl enable-linger chan` 才能在无登录会话时开机启动。
3. `ProtectHome=read-only` 与 `ProtectSystem=full` 下必须显式 `ReadWritePaths` 放开 `/home/chan/.zcode`（settings/session 写入）与 `/mnt/fs/ZCode`，否则服务启动即因写权限失败。
4. 重新构建产物后需 `sudo systemctl restart zcode.service` 才生效。

**运维命令**：

```bash
sudo systemctl enable --now zcode.service   # 开机自启并立即启动
sudo systemctl status zcode.service
sudo systemctl restart zcode.service        # 重新构建后生效
journalctl -u zcode.service -f              # 跟踪日志
```

### 回归测试路径与执行命令

无自动化单测（构建/部署类问题无法在单元层表达），以可重复验证脚本替代。构建产物验证：

```bash
node apps/zcode-cli/packages/cli/dist/zcode.cjs --version   # 期望输出 0.16.9
```

服务端契约验证（期望：无 token 401 / 带 token 200 / 错误 token 401 / WS 无 token 被拒）：

```bash
TOKEN=<token>
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3030/api/server-info              # 401
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3030/api/server-info?token=$TOKEN" # 200
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3030/api/server-info?token=wrong"  # 401
```

systemd 生命周期验证（期望：enabled / active / 崩溃后 PID 变化并自动恢复 / stop 后端口释放）：

```bash
systemctl is-enabled zcode.service && systemctl is-active zcode.service

# 崩溃自愈：杀主进程后应自动拉起且 PID 变化
OLD=$(systemctl show -p MainPID --value zcode.service); sudo kill -9 "$OLD"; sleep 8
NEW=$(systemctl show -p MainPID --value zcode.service)
[ "$OLD" != "$NEW" ] && [ "$NEW" != "0" ] && echo "AUTO-RESTART OK"

# stop 后端口必须释放，否则残留进程会占用 3030
sudo systemctl stop zcode.service; sleep 2
ss -tln | grep -q 3030 && echo "PORT STILL BOUND (BAD)" || echo "PORT RELEASED (OK)"
sudo systemctl start zcode.service
```

### 已排除的无效方案

- 在 `apps/zcode-cli` 子工作区执行 `pnpm run build`（`turbo: not found`）。
- 对 `/api/*` 使用 `Authorization: Bearer <token>` 鉴权（服务端不解析该 Header，稳定 401）。
- 在 systemd 单元中用裸 `node` 作为 `ExecStart`（本机无 `/usr/bin/node`，systemd 不加载 nvm 的 shell profile，启动即失败）。
- 使用 `systemctl --user` 单元而不开 linger（无登录会话时不会开机自启）。

---

## 2026-09-22 · Web 抽拉侧栏收起/展开（三角形角标 + 移动端悬浮 banner）

### 症状

Web 模式下左侧任务栏只有桌面端左上角浮层一个收起入口，延边没有角标；移动端屏幕宽窗口收起后没有任何展开入口。首版实现把「点角标收起后刷新又被自动展开」的现象归因于 CSS 动画。

### 触发条件

改动 `useAppPanels.handleToggleSidebar` 的收起态持久化逻辑，或在侧栏显隐上再引入一份状态。

### 根因

`resolveWorkspaceSidebarCollapsedAfterToggle` 的入参语义被误用：调用点传的是**切换前**的 `visible`，函数按 `!visible` 返回，写入的正是本次操作的**反向**值（收起写成展开）。React 内部用函数式 `setState` 计算的 `nextVisible` 才是唯一可信的「下一状态」，跨参数传递旧状态即产生取反。

### 最终修复

- 领域函数入参改名为 `nextIsSidebarVisible`，调用点传入与状态更新同一个 next 值（`packages/ui/src/hooks/useAppPanels.ts`）。
- 侧栏显隐仍由 `useAppPanels` 唯一持有；角标、悬浮 banner、快捷键、窄宽自动收起共用同一条写入路径 `handleToggleSidebar`。
- 呈现规则（首帧收起态、覆盖层、角标/banner 可见性、banner 位置钳制）下沉到纯函数 `packages/ui/src/lib/workspaceSidebarCollapse.ts`，storage 可注入。
- 移动端屏幕（`max-width: 767px`）侧栏改为覆盖层 + 遮罩，收起宽度恒为 0，复用外层已有的 width 过渡得到抽拉动画，不新增抽屉状态机。
- 覆盖层收起态隐藏角标（入口交给悬浮 banner），展开态才显示角标；覆盖层收起态边框只在展开时加，否则 `box-sizing` 下收起宽度多出 1px 露边。

### 回归测试与执行命令

```bash
cd /mnt/fs/ZCode/packages/ui
pnpm test                                  # node --import tsx --test test/*.test.ts
pnpm test:sidebar-collapse:e2e             # Playwright 无头验收（需 zcode.service 在跑）
```

### 红绿证据

- 红：新增 `test/workspaceSidebarCollapse.test.ts` 时模块尚不存在 → `ERR_MODULE_NOT_FOUND`；
  首版实现下浏览器 E2E 报 `FAIL desktop: 再点角标恢复展开`（`storedCollapsed` 仍为 `"true"`）与 `FAIL mobile: 刷新后仍保持收起`（写入的是 `"false"`）。
- 绿：修正入参语义后单测 14/14 通过（`packages/ui` 全量），E2E 20/20 项通过（1440×900 与 390×844 双视口）。

### 适用环境/版本

Node 24.14.0（`mise.toml`/nvm 锁定）、pnpm 10.33.2、`@zcode/ui` + `@zcode/web`（Vite 8）。E2E 复用 `playwright-core@1.59.1`（与 `packages/desktop` 同版本）+ 系统 Chrome，token 从 `/etc/zcode/zcode.env` 读。

### 已排除的无效方案

- 在 `WorkspaceSidebar` 内部再存一份 `collapsed` state：与 `useAppPanels` 形成两条写入路径，切换 workspace 后状态漂移。
- 用 `window.innerWidth` + `resize` 监听判定移动端：与仓库既有 `max-md` 断点语义漂移，且漏掉旋转屏幕；改用 `matchMedia` 订阅。
- 收起后把侧栏继续留在流式布局只改透明度：移动端展开时会把会话区挤到不可读，且需要额外的遮罩状态机。

### 附带坑：`pnpm typecheck` 会污染 zcode.service 的服务端产物

**日期/作用域**：2026-09-22，`packages/server` + `zcode.service`。

**症状**：改完前端跑完 `pnpm typecheck` 后 `sudo systemctl restart zcode.service`，服务进入 `activating (auto-restart)` 崩溃循环：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/mnt/fs/ZCode/packages/server/src/zcode-builtin-provider-config-source.js'
  imported from /mnt/fs/ZCode/packages/server/src/index.ts
```

**根因**：`pnpm typecheck` = `tsc -b packages/server ...`（`composite` + `outDir: dist`），会把 `packages/server/dist` 覆写成**逐文件** tsc 产物（`entry-http.js` 只剩约 1.3 KB，且混入 `.d.ts`）。运行中的进程不受影响，但重启后加载的是这份 tsc 产物而非 tsup bundle，入口里的 `src/*.ts` 相对导入即解析失败。

**最终修复**：重建 tsup 产物后再重启服务（先删 dist，否则残留 `.d.ts` 会留在产物里）：

```bash
node -e "require('node:fs').rmSync('packages/server/dist',{recursive:true,force:true})"
pnpm --filter @zcode/server build            # 产物 entry-http.js ≈ 2.9 MB
ls packages/server/dist | grep -c '\.d\.ts'  # 必须为 0
sudo systemctl restart zcode.service
systemctl is-active zcode.service && curl -sso /dev/null -w '%{http_code}\n' http://127.0.0.1:3030/
```

**验证入口**：`packages/ui` 的 `pnpm test:sidebar-collapse:e2e` 直连 3030，服务没起来会直接失败，可当部署冒烟测试。

**已排除**：误判为鉴权或环境变量问题（`?token=` 换 Cookie 行为未变，静态首页仍 200，只有 `/api/*` 才暴露进程已死）。

### 补充缺陷：悬浮按钮展开写在 `pointerup` 里，触摸点击后侧栏无反应

**日期/作用域**：2026-09-22，`packages/ui/src/app-shell/WorkspaceSidebarFloatingBanner.tsx`。

**症状**：移动端窗口大小下点击悬浮展开按钮，侧栏完全无反应（用户实测）；而 Playwright 用 `mouse.click` 的验收脚本却全部通过。

**根因（有事件序列证据）**：展开动作写在 `onPointerUp`。触摸输入的序列是
`pointerdown → touchstart → pointerup → touchend → click`，`click` 由浏览器在 `touchend` 后按坐标重新命中派发；
`pointerup` 里同步展开会让遮罩先挂载，随后那个 `click` 命中的是刚出现的遮罩，于是又被立即收起，
净效果就是“点了没反应”。鼠标路径 `click` 目标即按钮本身，所以旧脚本测不出来。

**最终修复**：`pointerup` 只做落位持久化，并用 `suppressNextClickRef` 标记“拖动后的那次 click 要吞掉”；
展开收敛为 `onClick` 唯一入口（同时天然覆盖键盘 Enter/Space 的 `detail=0` click）。
悬浮按钮同时按需求精简为单图标 44x44 圆钮（原先 logo + 两个图标并排）。

**回归测试与执行命令**：`packages/ui/test/workspaceSidebarCollapse.e2e.mjs` 新增
`hasTouch/isMobile` 触摸上下文段落（`page.tap` + `touchscreen.tap` 坐标点击），并新增
「拖动结束的 click 不误触发展开」断言。执行：`cd packages/ui && pnpm test:sidebar-collapse:e2e`。

**红绿证据**：把展开临时退回 `pointerup` 后重建产物，触摸用例报
`FAIL touch: tap 按钮展开侧栏（缺陷回归护栏）`（`panel.width=0`、`banner` 仍可见）；
恢复修复版本后 27/27 全绿。

**已排除的无效方案**：只测 `mouse.click` 就宣称浏览器验证通过（触摸与鼠标的事件序列不同，必须双输入路径覆盖）；
给遮罩加延时或用 `setTimeout` 错开 click（治标且引入时序竞态，正解是把展开动作放到 click 阶段）。

### 层级阶梯：抽屉式侧栏必须高于会话输入框的 stacking context

**日期/作用域**：2026-09-22，`packages/ui/src/app-shell/WorkspaceShellLayout.tsx`（侧栏覆盖层）、`DesktopTopOverlay.tsx`、`WorkspaceSidebarCollapseTab.tsx`、`WorkspaceSidebarFloatingBanner.tsx`。

**症状**：移动端屏幕展开侧栏后，侧栏视图元素下半部分被任务输入框遮住。

**根因（命中测试证据）**：`.chat-composer-region` 作为 flex item 带 `z-20`，本身构成 stacking context；`#content` 在 DOM 中排在侧栏面板之后。侧栏覆盖层当时也是 `z-20`，同层时按 DOM 顺序输入框胜出，于是绘制在抽屉之上。把抽屉 `zIndex` 临时改 999 后遮挡立即消失（`inSidebar:false → true`），确认是层级而非布局问题。

**最终修复（显式层级阶梯，会话内容/composer=20 < 遮罩 < 抽屉 < 浮层入口）**：

| 元素                                                     | z-index    | 理由                                 |
| -------------------------------------------------------- | ---------- | ------------------------------------ |
| `.chat-composer-region`（会话输入框）                    | 20（既有） | 不动它，避免影响会话内部叠放         |
| 侧栏遮罩 `workspace-sidebar-overlay-scrim`               | 30         | 盖住含输入框的会话内容，点空白即收起 |
| 侧栏覆盖层 `#sidebar`                                    | 40         | 必须 > 20，抽屉压在输入框之上        |
| 顶部浮层 `DesktopTopOverlay`（抽屉展开时）/角标/悬浮按钮 | 50         | 入口始终可见可点                     |

`DesktopTopOverlay` 新增可选 `className`，抽屉展开时由 shell 传 `z-50`，避免抬升抽屉后丢掉左上角浮层入口。

**回归测试与执行命令**：`readSidebarOcclusion()` 在侧栏与输入框的重叠区做网格命中测试（取样前临时隐藏遮罩，避免遮罩干扰两者次序判定），断言 `occluded === 0`，并断言 `20 < scrimZ < sidebarZ`。执行：`cd packages/ui && pnpm test:sidebar-collapse:e2e`。

**红绿证据**：抽屉退回 `z-20` 后重建产物 →
`FAIL mobile: 展开的侧栏不被会话输入框遮挡 :: {"samples":1066,"occluded":287,"sidebarZ":20}`（触摸段同败）；
恢复 `z-40` 后 `occluded: 0`，30/30 通过。

**已排除的无效方案**：给侧栏加 `z-50` 却不同步遮罩与浮层（浮层入口被抽屉吃掉）；用 `position: fixed` 或提层到 `#root`（跨 stacking context 迁移，波及 react-resizable-panels 布局）；靠调整 DOM 顺序让侧栏排最后（外层是 CSS 变量驱动的自定义 split，顺序变更影响流式布局与分隔线）。
