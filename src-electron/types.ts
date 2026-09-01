export interface ElectronAPI {
  /** 运行平台（preload 注入 process.platform，如 darwin / win32 / linux） */
  platform: string;
  getAppVersion: () => Promise<string>;
  getConfig: () => Promise<any>;
  /** 通知主进程实际明暗主题，更新窗口控制按钮颜色 */
  setTheme: (theme: string) => void;
  setConfig: (patch: any) => Promise<any>;
  ensureVault: (path: string) => Promise<void>;
  startWatch: (vaultPath?: string) => Promise<void>;
  listDir: (rel: string) => Promise<any[]>;
  readFile: (rel: string) => Promise<any>;
  writeFile: (rel: string, content: string) => Promise<void>;
  createNote: (dir: string, title: string, content?: string | null) => Promise<string>;
  createDir: (parent: string, name: string) => Promise<string>;
  renameEntry: (rel: string, newName: string) => Promise<string>;
  moveEntry: (rel: string, dstDir: string) => Promise<string>;
  deleteEntry: (rel: string) => Promise<void>;
  searchVault: (query: string) => Promise<any[]>;
  listAllNotes: () => Promise<any[]>;
  indexLinks: () => Promise<any[]>;
  saveAttachment: (filename: string, base64Data: string) => Promise<string>;
  fetchPage: (url: string) => Promise<any>;
  downloadImages: (urls: string[], vaultPath?: string) => Promise<any[]>;
  interactiveScreenshot: () => Promise<string | null>;
  aiChatList: () => Promise<any[]>;
  aiChatLoad: (id: string) => Promise<any>;
  aiChatSave: (doc: any) => Promise<void>;
  aiChatDelete: (id: string) => Promise<void>;
  aiChat: (params: any) => Promise<void>;
  /** 打开系统文件选择框，返回选中图片的 data URL（最多 4 张） */
  pickImages: () => Promise<string[]>;
  /** 打开系统目录选择框，返回选中目录路径或 null */
  pickDirectory: () => Promise<string | null>;
  /** 将绝对路径转换为 file:// URL（图片渲染用） */
  convertFileSrc: (absPath: string) => string;
  fsChangeSubscribe: (callback: () => void) => () => void;
  aiChunkSubscribe: (requestId: string, callback: (chunk: any) => void) => () => void;
  /** 读取外部文档（系统唤起打开，绕过 vault 边界，绝对路径） */
  readExternalFile: (absPath: string) => Promise<any>;
  /** 写回外部文档（原子写入原路径） */
  writeExternalFile: (absPath: string, content: string) => Promise<any>;
  /** 拉取启动早期未能推送的待打开文件列表 */
  getPendingOpens: () => Promise<string[]>;
  /** 渲染进程已就绪（先订阅 open-file:request 再发送），主进程可安全推送 */
  openFileReady: () => void;
  /** 订阅系统打开文件请求（主进程 → 渲染进程推送） */
  onOpenFileRequest: (callback: (absPath: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
