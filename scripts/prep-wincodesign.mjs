// 修复 Windows 无管理员/开发者模式时 electron-builder 打包失败的问题。
//
// 根因：electron-builder 需解压 winCodeSign（内含 rcedit/signtool，用于设置图标与签名）。
// 该 7z 含 darwin 下的符号链接，Windows 未开启开发者模式时创建符号链接无权限，
// 7za 返回非零退出码，electron-builder 反复重试后报 "Cannot create symbolic link" 失败。
//
// 方案：手动下载并解压该包到缓存规范路径（忽略符号链接报错，Windows 所需文件不受影响），
// 使 electron-builder 命中缓存而跳过解压。幂等：缓存就绪后直接跳过。
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const NAME = "winCodeSign";
const VERSION = "2.6.0";
const URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${NAME}-${VERSION}/${NAME}-${VERSION}.7z`;

function cacheRoot() {
  const base =
    process.platform === "win32"
      ? path.join(os.homedir(), "AppData", "Local", "electron-builder", "Cache")
      : path.join(os.homedir(), ".cache", "electron-builder");
  return path.join(base, NAME);
}

const canonical = [NAME, `${NAME}-${VERSION}`];
function signtool(dir) {
  return path.join(dir, "windows-10", "x64", "signtool.exe");
}

function usable() {
  const root = cacheRoot();
  return canonical.some((n) => fs.existsSync(signtool(path.join(root, n))));
}

function find7za() {
  const t = process.platform;
  const cand =
    t === "win32" ? ["win", "x64", "7za.exe"] : t === "darwin" ? ["mac", "x64", "7za"] : ["linux", "x64", "7za"];
  const f = path.join("node_modules", "7zip-bin", ...cand);
  return fs.existsSync(f) ? f : null;
}

async function main() {
  // winCodeSign 仅 Windows 打包需要；macOS/Linux 上跳过，避免无谓下载与 Rosetta/网络依赖
  if (process.platform !== "win32") {
    console.log("[prep-wincodesign] 非 Windows 平台，跳过（winCodeSign 仅 Windows 打包需要）");
    return;
  }
  if (usable()) {
    console.log("[prep-wincodesign] winCodeSign 缓存已就绪，跳过");
    return;
  }
  const root = cacheRoot();
  fs.mkdirSync(root, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wcs-"));
  const arc = path.join(tmp, `${NAME}-${VERSION}.7z`);

  console.log("[prep-wincodesign] 下载并预置 winCodeSign 缓存（规避符号链接权限问题）…");
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`winCodeSign 下载失败 HTTP ${res.status}`);
  fs.writeFileSync(arc, Buffer.from(await res.arrayBuffer()));

  const seven = find7za();
  if (!seven) throw new Error("未找到 node_modules/7zip-bin 下的 7za");
  // 解压会因 darwin/*/lib/*.dylib 符号链接无权创建而返回非零退出码；Windows 所需文件不受影响，忽略即可
  try {
    execSync(`"${seven}" x -bd "${arc}" -o"${tmp}"`, { stdio: "ignore" });
  } catch {
    /* 符号链接创建失败可忽略 */
  }
  if (!fs.existsSync(signtool(tmp))) throw new Error("解压后未找到 windows-10/x64/signtool.exe");

  for (const n of canonical) {
    const dst = path.join(root, n);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(tmp, dst, { recursive: true });
    // 补齐解压失败的符号链接占位（仅 Windows 打包，darwin 内容无用）
    for (const dylib of ["libcrypto.dylib", "libssl.dylib"]) {
      const p = path.join(dst, "darwin", "10.12", "lib", dylib);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (!fs.existsSync(p)) fs.writeFileSync(p, "");
    }
    console.log(`[prep-wincodesign] 已写入缓存：${n}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(`[prep-wincodesign] ${e.message}`);
  process.exit(1);
});