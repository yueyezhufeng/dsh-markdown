import { create } from "zustand";
import { api } from "./api";
import type { Config, ViewMode } from "./types";
import type { LinkEntry } from "./api";

export type RightPanel = "outline" | "backlinks" | "ai";

/** 大文件阈值：超过则禁用实时预览（仅编辑模式） */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;

interface AppState {
  config: Config | null;
  vaultReady: boolean;

  currentRel: string | null;
  /** 当前打开的外部文件（系统双击唤起，vault 之外，绝对路径；可编辑并写回原路径） */
  externalPath: string | null;
  content: string;
  savedContent: string;
  fileSize: number;
  dirty: boolean;
  largeFile: boolean;
  /** 打开时是否有外部修改待处理 */
  modifiedOutside: boolean;

  viewMode: ViewMode;
  rightPanel: RightPanel;
  sidebarVisible: boolean;
  rightVisible: boolean;
  /** 右侧栏宽度（可拖拽调整，240–560） */
  rightWidth: number;
  /** 侧栏宽度（可拖拽调整，180–420） */
  sidebarWidth: number;
  /** 文件树刷新信号（递增触发重载） */
  treeVersion: number;
  linkIndex: LinkEntry[];
  /** 链接索引刷新信号 */
  linkVersion: number;
  /** 跳转请求：[[wikilink]] 点击后由编辑器/预览触发 */
  jumpToNote: { target: string; ts: number } | null;

  init: () => Promise<void>;
  selectVault: (path: string) => Promise<void>;
  openFile: (rel: string) => Promise<void>;
  openExternal: (absPath: string) => Promise<void>;
  closeFile: () => Promise<void>;
  updateContent: (text: string) => void;
  saveNow: () => Promise<void>;
  reloadCurrent: () => Promise<void>;
  bumpTree: () => void;
  refreshLinks: () => Promise<void>;
  set: <K extends keyof AppState>(patch: Pick<AppState, K>) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastLinkScan = 0;
let linkScanRunning = false;

export const useStore = create<AppState>((set, get) => ({
  config: null,
  vaultReady: false,

  currentRel: null,
  externalPath: null,
  content: "",
  savedContent: "",
  fileSize: 0,
  dirty: false,
  largeFile: false,
  modifiedOutside: false,

  viewMode: "split",
  rightPanel: "outline",
  sidebarVisible: true,
  rightVisible: true,
  rightWidth: Number(localStorage.getItem("dsh.rightWidth")) || 300,
  sidebarWidth: Number(localStorage.getItem("dsh.sidebarWidth")) || 250,
  treeVersion: 0,
  linkIndex: [],
  linkVersion: 0,
  jumpToNote: null,

  set: (patch) => set(patch as never),

  init: async () => {
    const cfg = await api.getConfig();
    const ready = !!cfg.vaultPath;
    set({ config: cfg, vaultReady: ready });
    if (ready) {
      await api.startWatch().catch(() => {});
      get().refreshLinks();
    }
  },

  selectVault: async (path) => {
    await api.ensureVault(path);
    const cfg = await api.setConfig({ vaultPath: path });
    set({ config: cfg, vaultReady: true, treeVersion: get().treeVersion + 1, externalPath: null });
    await api.startWatch().catch(() => {});
    get().refreshLinks();
  },

  openFile: async (rel) => {
    // 切换前先落盘未保存内容（含外部文件）
    if (get().dirty && (get().currentRel || get().externalPath)) await get().saveNow();
    const r = await api.readFile(rel);
    set({
      currentRel: rel,
      externalPath: null,
      content: r.content,
      savedContent: r.content,
      fileSize: r.size,
      dirty: false,
      largeFile: r.size > LARGE_FILE_BYTES,
      modifiedOutside: false,
      // 大文件自动切纯编辑
      viewMode: r.size > LARGE_FILE_BYTES ? "edit" : get().viewMode === "edit" ? "edit" : get().viewMode,
    });
  },

  openExternal: async (absPath) => {
    if (get().dirty && (get().currentRel || get().externalPath)) await get().saveNow();
    const r = await api.readExternalFile(absPath);
    set({
      currentRel: null,
      externalPath: absPath,
      content: r.content,
      savedContent: r.content,
      fileSize: r.size,
      dirty: false,
      largeFile: r.size > LARGE_FILE_BYTES,
      modifiedOutside: false,
      viewMode: r.size > LARGE_FILE_BYTES ? "edit" : get().viewMode === "edit" ? "edit" : get().viewMode,
    });
  },

  closeFile: async () => {
    // 关闭前若有未保存内容先落盘（外部文件写回原路径，vault 文件写回相对路径）
    if (get().dirty && (get().currentRel || get().externalPath)) await get().saveNow().catch(() => {});
    set({
      currentRel: null,
      externalPath: null,
      content: "",
      savedContent: "",
      fileSize: 0,
      dirty: false,
      largeFile: false,
      modifiedOutside: false,
    });
  },

  updateContent: (text) => {
    set({ content: text, dirty: text !== get().savedContent });
    if (saveTimer) clearTimeout(saveTimer);
    // 自动保存：800ms 防抖
    saveTimer = setTimeout(() => {
      void get().saveNow();
    }, 800);
  },

  saveNow: async () => {
    const { currentRel, externalPath, content, dirty } = get();
    if (!dirty) return;
    if (externalPath) {
      // 外部文件写回原绝对路径（主进程原子写入）
      await api.writeExternalFile(externalPath, content);
      set({ savedContent: content, dirty: false, fileSize: new Blob([content]).size });
      return;
    }
    if (!currentRel) return;
    await api.writeFile(currentRel, content);
    set({
      savedContent: content,
      dirty: false,
      fileSize: new Blob([content]).size,
      linkVersion: get().linkVersion + 1,
    });
  },

  reloadCurrent: async () => {
    const ext = get().externalPath;
    if (ext) {
      const r = await api.readExternalFile(ext);
      set({
        content: r.content,
        savedContent: r.content,
        fileSize: r.size,
        dirty: false,
        largeFile: r.size > LARGE_FILE_BYTES,
        modifiedOutside: false,
      });
      return;
    }
    const rel = get().currentRel;
    if (!rel) return;
    const r = await api.readFile(rel);
    set({
      content: r.content,
      savedContent: r.content,
      fileSize: r.size,
      dirty: false,
      largeFile: r.size > LARGE_FILE_BYTES,
      modifiedOutside: false,
    });
  },

  bumpTree: () => set({ treeVersion: get().treeVersion + 1 }),

  refreshLinks: async () => {
    // 全库扫描节流：3 秒内多次触发只扫一次（连续保存/监听风暴保护）
    const now = Date.now();
    if (now - lastLinkScan < 3000 || linkScanRunning) return;
    linkScanRunning = true;
    try {
      const links = await api.indexLinks();
      set({ linkIndex: links, linkVersion: get().linkVersion + 1 });
    } catch {
      /* 静默失败 */
    } finally {
      linkScanRunning = false;
      lastLinkScan = Date.now();
    }
  },
}));
