// 开发启动前：清理占用 dev 端口的残留进程
// Windows 上常见：关闭终端窗口后 vite/node 子进程仍存活，导致下次 electron:dev 报 "Port 1430 is already in use" 直接退出。
import { execSync } from "node:child_process";

const PORT = process.argv[2] ?? "1430";

function win32() {
  const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: "utf8" });
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && pid !== "0") pids.add(pid);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`);
      console.log(`[kill-port] 已结束占用端口 ${PORT} 的残留进程 PID=${pid}`);
    } catch {
      /* 已退出则忽略 */
    }
  }
}

function posix() {
  const out = execSync(`lsof -ti:${PORT}`, { encoding: "utf8" }).trim();
  if (!out) return;
  for (const pid of out.split(/\s+/)) {
    try {
      execSync(`kill ${pid}`);
      console.log(`[kill-port] 已结束占用端口 ${PORT} 的残留进程 PID=${pid}`);
    } catch {
      /* 已退出则忽略 */
    }
  }
}

try {
  if (process.platform === "win32") win32();
  else posix();
} catch {
  /* 无占用则无需处理 */
}