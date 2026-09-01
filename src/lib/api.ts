/**
 * Electron API 桥接层
 *
 * 当运行在 Electron 环境时，window.electronAPI 由 preload 脚本注入。
 * 当运行在 Tauri 环境时，isElectron() 返回 false，api 回退到 Tauri invoke。
 *
 * 前端组件统一通过此模块调用，无需感知底层平台。
 */
import type { Config } from "./types";

export interface ChatSummary {
  id: string;
  title: string;
  modified: number;
}

export interface ChatDoc {
  id: string;
  title: string;
  modified: number;
  messages: unknown;
}

export interface FsNode {
  name: string;
  relPath: string;
  isDir: boolean;
  size: number;
  title: string | null;
}

export interface ReadResult {
  content: string;
  size: number;
  modified: number;
}

export interface SearchHit {
  relPath: string;
  lineNo: number;
  lineText: string;
}

export interface LinkEntry {
  source: string;
  target: string;
}

export interface NoteMetaItem {
  relPath: string;
  title: string | null;
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
  images: string[];
}

function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

function ensureApi() {
  if (!isElectron()) throw new Error("当前非 Electron 环境");
  return (window as any).electronAPI;
}

function tauriInvoke<T>(cmd: string, args?: any): Promise<T> {
  return import("@tauri-apps/api/core").then((m) => m.invoke<T>(cmd, args));
}

export const api = {
  getConfig: (): Promise<Config> =>
    isElectron() ? ensureApi().getConfig() : tauriInvoke<Config>("get_config"),

  setConfig: (patch: Partial<Config>): Promise<Config> =>
    isElectron() ? ensureApi().setConfig(patch) : tauriInvoke<Config>("set_config", patch),

  ensureVault: (path: string): Promise<void> =>
    isElectron() ? ensureApi().ensureVault(path) : tauriInvoke<void>("ensure_vault", { path }),

  startWatch: (vaultPath?: string): Promise<void> =>
    isElectron() ? ensureApi().startWatch(vaultPath) : tauriInvoke<void>("start_watch"),

  listDir: (rel: string): Promise<FsNode[]> =>
    isElectron() ? ensureApi().listDir(rel) : tauriInvoke<FsNode[]>("list_dir", { rel }),

  readFile: (rel: string): Promise<ReadResult> =>
    isElectron() ? ensureApi().readFile(rel) : tauriInvoke<ReadResult>("read_file", { rel }),

  writeFile: (rel: string, content: string): Promise<void> =>
    isElectron() ? ensureApi().writeFile(rel, content) : tauriInvoke<void>("write_file", { rel, content }),

  createNote: (dir: string, title: string, content?: string): Promise<string> =>
    isElectron()
      ? ensureApi().createNote(dir, title, content ?? null)
      : tauriInvoke<string>("create_note", { dir, title, content: content ?? null }),

  createDir: (parent: string, name: string): Promise<string> =>
    isElectron() ? ensureApi().createDir(parent, name) : tauriInvoke<string>("create_dir", { parent, name }),

  renameEntry: (rel: string, newName: string): Promise<string> =>
    isElectron() ? ensureApi().renameEntry(rel, newName) : tauriInvoke<string>("rename_entry", { rel, newName }),

  moveEntry: (rel: string, dstDir: string): Promise<string> =>
    isElectron() ? ensureApi().moveEntry(rel, dstDir) : tauriInvoke<string>("move_entry", { rel, dstDir }),

  deleteEntry: (rel: string): Promise<void> =>
    isElectron() ? ensureApi().deleteEntry(rel) : tauriInvoke<void>("delete_entry", { rel }),

  searchVault: (query: string): Promise<SearchHit[]> =>
    isElectron() ? ensureApi().searchVault(query) : tauriInvoke<SearchHit[]>("search_vault", { query }),

  listAllNotes: (): Promise<NoteMetaItem[]> =>
    isElectron() ? ensureApi().listAllNotes() : tauriInvoke<NoteMetaItem[]>("list_all_notes"),

  indexLinks: (): Promise<LinkEntry[]> =>
    isElectron() ? ensureApi().indexLinks() : tauriInvoke<LinkEntry[]>("index_links"),

  saveAttachment: (filename: string, base64Data: string): Promise<string> =>
    isElectron()
      ? ensureApi().saveAttachment(filename, base64Data)
      : tauriInvoke<string>("save_attachment", { filename, base64Data }),

  fetchPage: (url: string): Promise<PageContent> =>
    isElectron() ? ensureApi().fetchPage(url) : tauriInvoke<PageContent>("fetch_page", { url }),

  downloadImages: (urls: string[]): Promise<string[]> =>
    isElectron() ? ensureApi().downloadImages(urls) : tauriInvoke<string[]>("download_images", { urls }),

  interactiveScreenshot: (): Promise<string | null> =>
    isElectron() ? ensureApi().interactiveScreenshot() : tauriInvoke<string | null>("interactive_screenshot"),

  aiChatList: (): Promise<ChatSummary[]> =>
    isElectron() ? ensureApi().aiChatList() : tauriInvoke<ChatSummary[]>("ai_chat_list"),

  aiChatLoad: (id: string): Promise<ChatDoc> =>
    isElectron() ? ensureApi().aiChatLoad(id) : tauriInvoke<ChatDoc>("ai_chat_load", { id }),

  aiChatSave: (doc: ChatDoc): Promise<void> =>
    isElectron() ? ensureApi().aiChatSave(doc) : tauriInvoke<void>("ai_chat_save", { doc }),

  aiChatDelete: (id: string): Promise<void> =>
    isElectron() ? ensureApi().aiChatDelete(id) : tauriInvoke<void>("ai_chat_delete", { id }),

  readExternalFile: (absPath: string): Promise<ReadResult> =>
    isElectron() ? ensureApi().readExternalFile(absPath) : Promise.reject(new Error("仅 Electron 支持外部文件")),

  writeExternalFile: (absPath: string, content: string): Promise<void> =>
    isElectron() ? ensureApi().writeExternalFile(absPath, content) : Promise.reject(new Error("仅 Electron 支持外部文件")),

  getPendingOpens: (): Promise<string[]> =>
    isElectron() ? ensureApi().getPendingOpens() : Promise.resolve([]),

  openFileReady: (): void => { if (isElectron()) ensureApi().openFileReady(); },

  onOpenFileRequest: (callback: (absPath: string) => void): (() => void) =>
    isElectron() ? ensureApi().onOpenFileRequest(callback) : () => {},
};

/**
 * 订阅 fs-change 事件（跨平台通用）
 */
export function subscribeFsChange(callback: () => void): () => void {
  if (isElectron()) return ensureApi().fsChangeSubscribe(callback);
  let un: (() => void) | null = null;
  void import("@tauri-apps/api/event")
    .then((m) => m.listen("fs-change", callback))
    .then((u) => {
      un = u;
    });
  return () => {
    un?.();
  };
}