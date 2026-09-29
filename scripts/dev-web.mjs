import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { withPinnedNodePath } from "./mise-toolchain-env.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// 3030 是 systemd zcode.service 的生产端口，本机开发与其冲突时统一退到 3031。
// server 读取 PORT，web 的 vite 代理读取 ZCODE_DEV_SERVER_PORT，两者必须指向同一端口。
const devServerPort = process.env.ZCODE_DEV_SERVER_PORT?.trim() || "3031";

// 只启动后端时复用同一端口注入逻辑，避免 `pnpm dev:server` 仍撞生产 3030。
const serverOnly = process.argv.includes("--server-only");
const innerScript = serverOnly ? "dev:server:inner" : "dev:web:inner";

const child = spawn(pnpmCommand, ["run", innerScript], {
  cwd: repoRoot,
  env: withPinnedNodePath(
    {
      ...process.env,
      PORT: process.env.PORT?.trim() || devServerPort,
      ZCODE_DEV_SERVER_PORT: devServerPort,
    },
    process.execPath,
  ),
  stdio: "inherit",
  // Windows 的 .cmd 入口需要 shell 才能被 Node spawn。
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(`[dev-web] failed to start: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
