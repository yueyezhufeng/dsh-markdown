// 构建前清理 dist-electron，避免旧构建残留的无用 chunk 混入安装包
import { rmSync } from "node:fs";

rmSync("dist-electron", { recursive: true, force: true });
console.log("[clean-electron] dist-electron 已清空");