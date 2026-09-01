/** 运行平台 + 快捷键修饰键文案（⌘ / Ctrl） */
function getPlatform(): string {
  if (typeof window !== "undefined" && (window as any).electronAPI?.platform) {
    return (window as any).electronAPI.platform;
  }
  return typeof navigator !== "undefined" ? String(navigator.platform || "") : "";
}

export const isMac = /mac|darwin/i.test(getPlatform());
/** 快捷键修饰键显示文案：macOS 用 ⌘，其他平台用 Ctrl */
export const MOD = isMac ? "⌘" : "Ctrl";