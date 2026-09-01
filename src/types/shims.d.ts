declare global {
  interface Window {
    /** Electron 环境由 preload 注入；Tauri 环境不存在 */
    electronAPI?: import("../../src-electron/types").ElectronAPI;
    /** prism 高亮全局实例 */
    __prism?: any;
  }
}

export {};