#!/usr/bin/env bash
#
# ZCode 去缓存全量编译 + systemd 重新部署脚本
#
# 背景（详见 docs/engineering-memory.md 的 EM-2026-09-21-01 与 EM-2026-09-22 附带坑）：
#   1. zcode.service 是系统级 systemd 单元，ExecStart 指向 packages/server/dist/entry-http.js；
#   2. 服务端产物必须由 tsup 生成——pnpm typecheck 会把 dist 覆写成逐文件 tsc 产物，
#      混入 .d.ts 且入口无法解析，重启后进入崩溃循环；
#   3. Agent 运行时由服务按 cwd 向上查找 apps/zcode-cli/packages/cli/dist/zcode.cjs，
#      所以重新部署必须同时重建 CLI/Agent、后端、Web 三份产物。
#
# 因此本脚本先清理缓存与产物（去缓存全量编译），再按依赖顺序重建，校验产物形态后重启服务。

set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$REPO_ROOT"

SERVICE_NAME="zcode.service"
HTTP_HEALTH_URL="http://127.0.0.1:3030/"
AGENT_BUNDLE_MIN_BYTES=$((1024 * 1024))
SERVER_ENTRY_MIN_BYTES=$((512 * 1024))

DO_RESTART=1
DO_INSTALL=1

usage() {
  cat <<'EOF'
用法: bash deploy.sh [选项]

在官方 main 分支拉取后，强制清理本地编译缓存与产物，全量重建 CLI/Agent、
后端与 Web 前端，然后重新部署 systemctl 的 zcode.service。

选项:
  --no-restart    只执行去缓存编译与产物校验，不重启 zcode.service
  --skip-install  跳过依赖同步（默认会按 pnpm-lock.yaml 安装依赖）
  -h, --help      显示本帮助
EOF
}

log() { printf '\n\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy] WARN:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\n\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

for argument in "$@"; do
  case "$argument" in
    --no-restart) DO_RESTART=0 ;;
    --skip-install) DO_INSTALL=0 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '未知参数: %s\n\n' "$argument" >&2
      usage >&2
      exit 2
      ;;
  esac
done

read_mise_tool_version() {
  sed -n "s/^$1[[:space:]]*=[[:space:]]*\"\([^\"]*\)\".*/\1/p" mise.toml | head -n 1
}

# ---------- 1. 前置检查（Fail-Fast） ----------

[[ -f package.json && -f pnpm-workspace.yaml ]] || die "请在 ZCode 仓库根目录运行本脚本"

EXPECTED_NODE_VERSION="$(read_mise_tool_version node)"
[[ -n "$EXPECTED_NODE_VERSION" ]] || die "无法从 mise.toml 解析锁定的 node 版本"

# systemd 单元用 nvm 的 Node 绝对路径启动，这里把整条构建链固定到同一版本，
# 避免默认 shell 里的旧 Node 产出与运行时不一致的产物。
ensure_node_version() {
  local current_version=""
  if command -v node >/dev/null 2>&1; then
    current_version="$(node -v)"
  fi
  if [[ "$current_version" == "v$EXPECTED_NODE_VERSION" ]]; then
    return 0
  fi

  local nvm_node_bin="$HOME/.nvm/versions/node/v$EXPECTED_NODE_VERSION/bin"
  if [[ -x "$nvm_node_bin/node" ]]; then
    export PATH="$nvm_node_bin:$PATH"
    current_version="$(node -v)"
  fi

  [[ "$current_version" == "v$EXPECTED_NODE_VERSION" ]] ||
    die "需要 Node v$EXPECTED_NODE_VERSION（mise.toml 锁定），当前为 ${current_version:-未安装}"
}

ensure_node_version
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请先按 mise.toml 安装 pnpm"

EXPECTED_PNPM_VERSION="$(read_mise_tool_version pnpm)"
ACTUAL_PNPM_VERSION="$(pnpm --version)"
if [[ -n "$EXPECTED_PNPM_VERSION" && "$ACTUAL_PNPM_VERSION" != "$EXPECTED_PNPM_VERSION" ]]; then
  warn "pnpm 版本为 $ACTUAL_PNPM_VERSION，mise.toml 锁定 $EXPECTED_PNPM_VERSION，继续执行"
fi

[[ -d node_modules && -d apps/zcode-cli/node_modules ]] ||
  die "依赖未安装，请先在仓库根执行 pnpm install"

if [[ "$DO_RESTART" -eq 1 ]]; then
  command -v systemctl >/dev/null 2>&1 || die "未找到 systemctl，无法重启 $SERVICE_NAME"
  systemctl cat "$SERVICE_NAME" >/dev/null 2>&1 || die "未找到 systemd 单元 $SERVICE_NAME"
  command -v sudo >/dev/null 2>&1 || die "未找到 sudo，无法重启 $SERVICE_NAME"
  sudo -n true 2>/dev/null || warn "sudo 需要密码，重启阶段会提示输入"
fi

# ---------- 2. 同步依赖 ----------

# pull 到新 main 后 package.json / pnpm-lock.yaml 可能引入新依赖，而 node_modules 仍是旧的。
# 不先同步依赖，后端 tsup 会在 esbuild 解析新依赖时直接失败（例如 @larksuiteoapi/node-sdk）。
# --frozen-lockfile 保证安装内容严格来自 lockfile，lockfile 与 package.json 不一致时立即失败。
sync_dependencies() {
  if [[ "$DO_INSTALL" -eq 0 ]]; then
    log "跳过依赖同步（--skip-install）"
    return 0
  fi

  log "同步依赖（pnpm install --frozen-lockfile）"
  pnpm install --frozen-lockfile
}

# ---------- 3. 清理缓存与产物 ----------

# 只删除仓库内路径，防止变量异常时误删仓库外文件。
remove_path() {
  local target="$1"
  case "$target" in
    "$REPO_ROOT"/*) ;;
    *) die "拒绝删除仓库外路径: $target" ;;
  esac
  [[ -e "$target" ]] || return 0
  rm -rf -- "$target"
  printf '  已清理 %s\n' "${target#"$REPO_ROOT"/}"
}

# 动态解析 @zcode/cli 的依赖闭包：只清理会被重新构建的包。
# 不能直接删 apps/zcode-cli/packages/*/dist —— node-repl-host 等包不在闭包内，
# 删掉后不会被重建，会导致 Agent 运行时的 MCP 宿主缺失。
list_cli_closure_dirs() {
  pnpm --filter "@zcode/cli..." list --depth -1 --json 2>/dev/null |
    node -e '
      let input = "";
      process.stdin.on("data", (chunk) => {
        input += chunk;
      });
      process.stdin.on("end", () => {
        for (const entry of JSON.parse(input)) {
          if (typeof entry?.path === "string" && entry.path) {
            process.stdout.write(entry.path + "\n");
          }
        }
      });
    '
}

purge_build_outputs() {
  log "清理编译缓存与产物（去缓存全量编译）"

  # Turborepo 本地缓存：--force 只忽略缓存命中，历史缓存目录仍会残留。
  remove_path "$REPO_ROOT/.turbo"
  remove_path "$REPO_ROOT/node_modules/.cache/turbo"
  remove_path "$REPO_ROOT/apps/zcode-cli/.turbo"
  remove_path "$REPO_ROOT/apps/zcode-cli/node_modules/.cache/turbo"

  local cli_closure_dirs=()
  local package_dir
  while IFS= read -r package_dir; do
    [[ -n "$package_dir" ]] && cli_closure_dirs+=("$package_dir")
  done < <(list_cli_closure_dirs)
  [[ ${#cli_closure_dirs[@]} -gt 0 ]] || die "无法解析 @zcode/cli 依赖闭包，pnpm list 输出为空"

  # 同时删除 dist 与 *.tsbuildinfo：composite 项目仅凭 tsbuildinfo 就会跳过 emit，
  # 只删 dist 不足以强制全量重编译。
  for package_dir in "${cli_closure_dirs[@]}"; do
    remove_path "$package_dir/dist"
    while IFS= read -r tsbuildinfo; do
      [[ -n "$tsbuildinfo" ]] && remove_path "$tsbuildinfo"
    done < <(find "$package_dir" -maxdepth 1 -name '*.tsbuildinfo' -type f 2>/dev/null)
  done

  # 后端必须重新生成 tsup bundle；Web 前端重新生成静态资源。
  remove_path "$REPO_ROOT/packages/server/dist"
  remove_path "$REPO_ROOT/packages/server/tsconfig.tsbuildinfo"
  remove_path "$REPO_ROOT/packages/web/dist"
  remove_path "$REPO_ROOT/packages/web/tsconfig.tsbuildinfo"
}

# ---------- 4. 全量构建 ----------

build_outputs() {
  # adapters 的 tsc 在内存受限机器上会 OOM（exit 134），与 build-desktop-agent-cli.mjs 保持一致提高堆上限。
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192"
  # pnpm 的 verify-deps-before-run 会在子 workspace 触发自动 install，可能解析不到根 workspace 包。
  export PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
  # TURBO_FORCE 等价于 --force：忽略已有缓存并重新执行任务（覆盖可能引入 turbo 的构建路径）。
  export TURBO_FORCE=1
  export TURBO_TELEMETRY_DISABLED=1

  log "1/3 编译 CLI / Agent（pnpm --filter \"@zcode/cli...\" build）"
  pnpm --filter "@zcode/cli..." build

  log "2/3 编译后端（pnpm --filter @zcode/server build）"
  pnpm --filter @zcode/server build

  log "3/3 编译 Web 前端（pnpm --filter @zcode/web build）"
  pnpm --filter @zcode/web build
}

# ---------- 5. 产物校验 ----------

file_size() { wc -c <"$1" | tr -d ' '; }

verify_artifacts() {
  log "校验构建产物"

  local agent_bundle="$REPO_ROOT/apps/zcode-cli/packages/cli/dist/zcode.cjs"
  local server_entry="$REPO_ROOT/packages/server/dist/entry-http.js"
  local web_index="$REPO_ROOT/packages/web/dist/index.html"

  [[ -s "$agent_bundle" ]] || die "缺少 Agent 产物：$agent_bundle"
  [[ -s "$server_entry" ]] || die "缺少后端产物：$server_entry"
  [[ -s "$web_index" ]] || die "缺少 Web 产物：$web_index"

  local agent_bundle_bytes server_entry_bytes
  agent_bundle_bytes="$(file_size "$agent_bundle")"
  server_entry_bytes="$(file_size "$server_entry")"
  ((agent_bundle_bytes >= AGENT_BUNDLE_MIN_BYTES)) ||
    die "Agent 产物过小（${agent_bundle_bytes} 字节），疑似构建不完整"
  ((server_entry_bytes >= SERVER_ENTRY_MIN_BYTES)) ||
    die "后端产物过小（${server_entry_bytes} 字节），疑似被 tsc 覆写"

  # pnpm typecheck 会把 server/dist 覆写成逐文件 tsc 产物并混入 .d.ts，
  # 这里显式断言 tsup bundle 形态，防止把污染产物部署上线。
  local declaration_count
  declaration_count="$(find "$REPO_ROOT/packages/server/dist" -name '*.d.ts' -type f | wc -l | tr -d ' ')"
  [[ "$declaration_count" == "0" ]] ||
    die "packages/server/dist 混入 $declaration_count 个 .d.ts，疑似被 tsc 覆写，请重新执行本脚本"

  printf '  Agent 产物 %s 字节\n' "$agent_bundle_bytes"
  printf '  后端产物 %s 字节\n' "$server_entry_bytes"
}

# ---------- 6. 重新部署 ----------

restart_service() {
  log "重新部署 $SERVICE_NAME"
  sudo systemctl daemon-reload
  sudo systemctl restart "$SERVICE_NAME"

  # Type=simple 的单元在进程 fork 后立即变为 active，但 HTTP 端口要再过约 1 秒才监听；
  # 只探测一次会把「尚未就绪」误判成「启动失败」，因此 active 与 HTTP 200 都要轮询等待。
  local attempt http_status="000"
  for attempt in $(seq 1 30); do
    if systemctl is-active --quiet "$SERVICE_NAME" && command -v curl >/dev/null 2>&1; then
      http_status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HTTP_HEALTH_URL" 2>/dev/null || true)"
      [[ "$http_status" == "200" ]] && break
    elif systemctl is-active --quiet "$SERVICE_NAME"; then
      break
    fi
    sleep 1
  done

  if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    journalctl -u "$SERVICE_NAME" -n 60 --no-pager || true
    die "$SERVICE_NAME 未进入 active 状态"
  fi

  if command -v curl >/dev/null 2>&1; then
    [[ "$http_status" == "200" ]] || die "健康检查失败：$HTTP_HEALTH_URL 返回 ${http_status:-无响应}"
    printf '  健康检查 %s -> %s\n' "$HTTP_HEALTH_URL" "$http_status"
  fi

  printf '  %s 状态: %s\n' "$SERVICE_NAME" "$(systemctl is-active "$SERVICE_NAME")"
}

# ---------- 主流程 ----------

log "仓库: $REPO_ROOT（$(git rev-parse --short HEAD 2>/dev/null || echo '未知提交')）"
sync_dependencies
purge_build_outputs
build_outputs
verify_artifacts

if [[ "$DO_RESTART" -eq 1 ]]; then
  restart_service
  log "部署完成：$SERVICE_NAME 已加载最新产物"
else
  log "编译完成（--no-restart）：未重启 $SERVICE_NAME"
fi
