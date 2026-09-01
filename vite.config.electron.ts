import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

// Electron 构建配置：
// - 渲染进程（React）构建到 dist/
// - 主进程 + preload 由 vite-plugin-electron 构建到 dist-electron/
// - 开发时：vite dev server 启动后自动拉起 Electron（加载 localhost:1430）
// - 打包时：npm run electron:build → electron-builder 产出 exe/dmg/AppImage
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "src-electron/main.ts",
        onstart: (args) => args.startup(),
      },
      {
        entry: "src-electron/preload.ts",
        onstart: (args) => args.reload(),
      },
    ]),
    renderer(),
  ],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/dist-electron/**"],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});