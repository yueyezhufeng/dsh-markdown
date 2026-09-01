import { ipcRenderer, contextBridge } from "electron";
import type { ElectronAPI } from "./types";

const api: ElectronAPI = {
  platform: process.platform,

  getAppVersion: () => ipcRenderer.invoke("config:get").then((c: any) => "0.1.0"),

  getConfig: () => ipcRenderer.invoke("config:get"),

  setTheme: (theme: string) => ipcRenderer.send("window:set_theme", theme),

  setConfig: (patch: any) => ipcRenderer.invoke("config:set", patch),

  ensureVault: (p: string) =>
    new Promise<void>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:ensure_vault-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve();
      };
      ipcRenderer.once("fs:ensure_vault-reply", handler);
      ipcRenderer.send("fs:ensure_vault", p);
    }),

  startWatch: (vaultPath?: string) =>
    new Promise<void>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("watcher:start-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve();
      };
      ipcRenderer.once("watcher:start-reply", handler);
      ipcRenderer.send("watcher:start", vaultPath);
    }),

  listDir: (rel: string) =>
    new Promise<any[]>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:list_dir-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:list_dir-reply", handler);
      ipcRenderer.send("fs:list_dir", rel);
    }),

  readFile: (rel: string) =>
    new Promise<any>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:read_file-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:read_file-reply", handler);
      ipcRenderer.send("fs:read_file", rel);
    }),

  writeFile: (rel: string, content: string) =>
    new Promise<void>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:write_file-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve();
      };
      ipcRenderer.once("fs:write_file-reply", handler);
      ipcRenderer.send("fs:write_file", rel, content);
    }),

  createNote: (dir: string, title: string, content?: string | null) =>
    new Promise<string>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:create_note-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:create_note-reply", handler);
      ipcRenderer.send("fs:create_note", dir, title, content ?? null);
    }),

  createDir: (parent: string, name: string) =>
    new Promise<string>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:create_dir-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:create_dir-reply", handler);
      ipcRenderer.send("fs:create_dir", parent, name);
    }),

  renameEntry: (rel: string, newName: string) =>
    new Promise<string>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:rename_entry-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:rename_entry-reply", handler);
      ipcRenderer.send("fs:rename_entry", rel, newName);
    }),

  moveEntry: (rel: string, dstDir: string) =>
    new Promise<string>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:move_entry-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:move_entry-reply", handler);
      ipcRenderer.send("fs:move_entry", rel, dstDir);
    }),

  deleteEntry: (rel: string) =>
    new Promise<void>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:delete_entry-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve();
      };
      ipcRenderer.once("fs:delete_entry-reply", handler);
      ipcRenderer.send("fs:delete_entry", rel);
    }),

  searchVault: (query: string) =>
    new Promise<any[]>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:search_vault-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:search_vault-reply", handler);
      ipcRenderer.send("fs:search_vault", query);
    }),

  listAllNotes: () =>
    new Promise<any[]>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:list_all_notes-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:list_all_notes-reply", handler);
      ipcRenderer.send("fs:list_all_notes");
    }),

  indexLinks: () =>
    new Promise<any[]>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:index_links-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:index_links-reply", handler);
      ipcRenderer.send("fs:index_links");
    }),

  saveAttachment: (filename: string, base64Data: string) =>
    new Promise<string>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fs:save_attachment-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fs:save_attachment-reply", handler);
      ipcRenderer.send("fs:save_attachment", filename, base64Data);
    }),

  fetchPage: (url: string) =>
    new Promise<any>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fetch:page-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fetch:page-reply", handler);
      ipcRenderer.send("fetch:page", url);
    }),

  downloadImages: (urls: string[], vaultPath?: string) =>
    new Promise<any>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("fetch:download_images-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("fetch:download_images-reply", handler);
      ipcRenderer.send("fetch:download_images", urls, vaultPath);
    }),

  interactiveScreenshot: () =>
    new Promise<any>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("screenshot:interactive-reply", handler);
        if (typeof r === "string") resolve(r);
        else if (r?.error) reject(new Error(r.error));
        else resolve(r ?? null);
      };
      ipcRenderer.once("screenshot:interactive-reply", handler);
      ipcRenderer.send("screenshot:interactive");
    }),

  aiChatList: () =>
    new Promise<any[]>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("chats:list-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("chats:list-reply", handler);
      ipcRenderer.send("chats:list");
    }),

  aiChatLoad: (id: string) =>
    new Promise<any>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("chats:load-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve(r);
      };
      ipcRenderer.once("chats:load-reply", handler);
      ipcRenderer.send("chats:load", id);
    }),

  aiChatSave: (doc: any) =>
    new Promise<void>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("chats:save-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve();
      };
      ipcRenderer.once("chats:save-reply", handler);
      ipcRenderer.send("chats:save", doc);
    }),

  aiChatDelete: (id: string) =>
    new Promise<void>((resolve, reject) => {
      const handler = (_e: Electron.IpcRendererEvent, r: any) => {
        ipcRenderer.removeListener("chats:delete-reply", handler);
        r.error ? reject(new Error(r.error)) : resolve();
      };
      ipcRenderer.once("chats:delete-reply", handler);
      ipcRenderer.send("chats:delete", id);
    }),

  aiChat: (params) =>
    new Promise<void>((resolve, reject) => {
      const chan = `ai-chunk:${params.requestId}`;
      const handler = (_e: Electron.IpcRendererEvent, chunk: any) => {
        if (chunk.error) { reject(new Error(chunk.error)); return; }
        if (chunk.done) { resolve(); return; }
      };
      ipcRenderer.on(chan, handler);
      ipcRenderer.send("ai:chat", params);
      setTimeout(() => {
        ipcRenderer.off(chan, handler);
        reject(new Error("AI 请求超时"));
      }, 300000);
    }),

  pickImages: () => ipcRenderer.invoke("dialog:pick_images"),
  pickDirectory: () => ipcRenderer.invoke("dialog:pick_directory"),

  fsChangeSubscribe: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("fs-change", handler);
    return () => ipcRenderer.removeListener("fs-change", handler);
  },

  convertFileSrc: (absPath: string): string => {
    // preload 拥有 Node 能力（sandbox:false），可直接转换 file:// URL
    try {
      const real = require("node:fs").realpathSync(absPath);
      return require("node:url").pathToFileURL(real).href;
    } catch {
      return require("node:url").pathToFileURL(absPath).href;
    }
  },

  aiChunkSubscribe: (requestId: string, callback: (chunk: any) => void) => {
    const chan = `ai-chunk:${requestId}`;
    const handler = (_e: Electron.IpcRendererEvent, chunk: any) => callback(chunk);
    ipcRenderer.on(chan, handler);
    return () => ipcRenderer.off(chan, handler);
  },

  readExternalFile: (absPath: string) => ipcRenderer.invoke("fs:read_external", absPath),

  writeExternalFile: (absPath: string, content: string) => ipcRenderer.invoke("fs:write_external", absPath, content),

  getPendingOpens: () => ipcRenderer.invoke("fs:get_pending_opens"),

  openFileReady: () => { ipcRenderer.send("open-file:ready"); },

  onOpenFileRequest: (callback: (absPath: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: string) => callback(p);
    ipcRenderer.on("open-file:request", handler);
    return () => ipcRenderer.removeListener("open-file:request", handler);
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);