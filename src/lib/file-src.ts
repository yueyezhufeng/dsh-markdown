/**
 * 将 vault 内文件绝对路径转换为可在渲染进程使用的 file:// URL。
 * - Electron：由 preload 暴露的 window.electronAPI.convertFileSrc 完成
 * - Tauri：回退到 @tauri-apps/api/core 的 convertFileSrc（asset 协议）
 */
export function convertFileSrc(absPath: string): string {
  if (typeof window !== "undefined" && (window as any).electronAPI?.convertFileSrc) {
    return (window as any).electronAPI.convertFileSrc(absPath);
  }
  // 同步回退：构造 file:// URL（渲染进程可直接访问本地文件路径，由 CSP/file 协议放行）
  const p = absPath.replace(/\\/g, "/");
  return `file://${p.startsWith("/") ? "" : "/"}${p}`;
}