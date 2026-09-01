import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, type RightPanel } from "./lib/store";
import { api, subscribeFsChange, type NoteMetaItem } from "./lib/api";
import type { NoteMeta } from "./lib/cm";
import FileTree from "./components/FileTree";
import Editor from "./components/Editor";
import Preview from "./components/Preview";
import MindmapView from "./components/MindmapView";
import GraphView from "./components/GraphView";
import OutlinePanel from "./components/OutlinePanel";
import BacklinkPanel from "./components/BacklinkPanel";
import AiPanel from "./components/AiPanel";
import QuickOpen from "./components/QuickOpen";
import SettingsDialog, { resolveTheme } from "./components/SettingsDialog";
import { isMac, MOD } from "./lib/platform";
import type { ScrollSyncHandle } from "./lib/scroll-sync";

export default function App() {
  const vaultReady = useStore((s) => s.vaultReady);
  const config = useStore((s) => s.config);
  const viewMode = useStore((s) => s.viewMode);
  const rightPanel = useStore((s) => s.rightPanel);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const rightVisible = useStore((s) => s.rightVisible);
  const rightWidth = useStore((s) => s.rightWidth);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const currentRel = useStore((s) => s.currentRel);
  const externalPath = useStore((s) => s.externalPath);
  const dirty = useStore((s) => s.dirty);
  const fileSize = useStore((s) => s.fileSize);
  const content = useStore((s) => s.content);
  const largeFile = useStore((s) => s.largeFile);
  const treeVersion = useStore((s) => s.treeVersion);
  const init = useStore((s) => s.init);
  const setStore = useStore((s) => s.set);
  const saveNow = useStore((s) => s.saveNow);
  const closeFile = useStore((s) => s.closeFile);
  const bumpTree = useStore((s) => s.bumpTree);
  const refreshLinks = useStore((s) => s.refreshLinks);
  const reloadCurrent = useStore((s) => s.reloadCurrent);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [newNote, setNewNote] = useState<string | null>(null); // null=关闭
  const [filter, setFilter] = useState("");
  const [notes, setNotes] = useState<NoteMetaItem[]>([]);
  const [externalChange, setExternalChange] = useState(false);

  // 分栏滚动联动：编辑器 ↔ 预览
  const editorSyncRef = useRef<ScrollSyncHandle | null>(null);
  const previewSyncRef = useRef<ScrollSyncHandle | null>(null);
  const syncLock = useRef(false);
  const syncEditorScroll = useCallback((line: number) => {
    previewSyncRef.current?.scrollToLine(line);
  }, []);
  const syncPreviewScroll = useCallback((line: number) => {
    editorSyncRef.current?.scrollToLine(line);
  }, []);

  // 主题
  const theme = config?.theme ?? "auto";
  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const applyTheme = useCallback((t: "light" | "dark") => {
    document.documentElement.dataset.theme = t;
    (window as any).electronAPI?.setTheme?.(t);
  }, []);
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved, applyTheme]);

  // 初始化 + 系统主题变化监听
  useEffect(() => {
    void init();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((config?.theme ?? "auto") === "auto") {
        applyTheme(resolveTheme("auto"));
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [init, config?.theme, applyTheme]);

  // 系统唤起打开文件（Windows 双击 .md 等 / macOS open-file）
  const lastOpenRef = useRef<{ abs: string; t: number } | null>(null);
  const handleOpenFileRequest = useCallback(async (absPath: string) => {
    try {
      // 去重：主进程推送与主动拉取可能重复投递同一路径
      const now = Date.now();
      if (lastOpenRef.current && lastOpenRef.current.abs === absPath && now - lastOpenRef.current.t < 2000) return;
      lastOpenRef.current = { abs: absPath, t: now };
      // 等待 init 完成（config 就绪），最多 3 秒
      let cfg = useStore.getState().config;
      for (let i = 0; i < 60 && !cfg; i++) {
        await new Promise((r) => setTimeout(r, 50));
        cfg = useStore.getState().config;
      }
      if (!cfg) return;
      let vault = cfg.vaultPath || null;
      if (!vault) {
        // 未设置知识库：以文件所在目录作为知识库，再正常打开
        const dir = absPath.replace(/[/\\][^/\\]+$/, "");
        if (!dir) return;
        await useStore.getState().selectVault(dir);
        vault = dir;
      }
      const rel = toVaultRel(vault, absPath);
      if (rel) { await useStore.getState().openFile(rel); return; }
      // vault 之外的文件：外部文档模式（可编辑、自动保存回原路径）
      await useStore.getState().openExternal(absPath);
    } catch (e) {
      alert(`打开文件失败：${e}`);
    }
  }, []);

  useEffect(() => {
    const unsub = api.onOpenFileRequest((p) => { void handleOpenFileRequest(p); });
    // 兜底：启动早期主进程未能推送的待打开文件
    void api.getPendingOpens().then((list) => list.forEach((p) => void handleOpenFileRequest(p)));
    // 先订阅再通知主进程，保证推送不丢
    void api.openFileReady();
    return unsub;
  }, [handleOpenFileRequest]);

  // 笔记列表缓存（补全 / wikilink 跳转用）
  useEffect(() => {
    if (!vaultReady) return;
    void api.listAllNotes().then(setNotes).catch(() => {});
  }, [vaultReady, treeVersion]);

  const notesGetter = useCallback((): NoteMeta[] => notes, [notes]);

  // 文件变化监听：刷新树；当前文件内容与磁盘不一致时提示重载（自己的保存不误报）
  useEffect(() => {
    if (!vaultReady) return;
    const unsub = subscribeFsChange(() => {
      bumpTree();
      refreshLinks();
      const st = useStore.getState();
      if (st.currentRel && !st.dirty) {
        void api
          .readFile(st.currentRel)
          .then((r) => {
            if (r.content !== useStore.getState().content) setExternalChange(true);
          })
          .catch(() => {});
      }
    });
    return unsub;
  }, [vaultReady, bumpTree, refreshLinks]);

  // 新建笔记：在当前笔记所在目录（无则根目录）创建并打开
  const createNewNote = async () => {
    const title = (newNote ?? "").trim();
    setNewNote(null);
    if (!title) return;
    try {
      const dir = useStore.getState().currentRel?.split("/").slice(0, -1).join("/") ?? "";
      const rel = await api.createNote(dir, title);
      bumpTree();
      refreshLinks();
      await useStore.getState().openFile(rel);
    } catch (e) {
      alert(String(e));
    }
  };

  // 标题栏拖动窗口（Electron 由 -webkit-app-region: drag 处理；Tauri 走 startDragging）
  const dragWindow = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    if (typeof window !== "undefined" && (window as any).electronAPI) return; // Electron 用 CSS 拖拽
    void import("@tauri-apps/api/window").then((m) => m.getCurrentWindow().startDragging());
  };

  // 侧栏拖宽
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(180, Math.min(420, startW + (ev.clientX - startX)));
      useStore.setState({ sidebarWidth: w });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem("dsh.sidebarWidth", String(useStore.getState().sidebarWidth));
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // 右栏拖宽
  const startRightResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(240, Math.min(560, startW + (startX - ev.clientX)));
      useStore.setState({ rightWidth: w });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem("dsh.rightWidth", String(useStore.getState().rightWidth));
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setQuickOpen((v) => !v);
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        setStore({ sidebarVisible: !useStore.getState().sidebarVisible });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow, setStore]);

  const jumpToLine = (line: number) => {
    setStore({ viewMode: useStore.getState().viewMode === "preview" ? "split" : useStore.getState().viewMode });
    // 滚动预览到标题：通过 anchor id
    setTimeout(() => {
      const el = document.querySelector(`.md-preview [data-line="${line}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (!el) {
        // 备选：滚动到对应 heading（按行号排序最近的标题）
        const heads = document.querySelectorAll(".md-preview h1,.md-preview h2,.md-preview h3,.md-preview h4");
        heads[0]?.scrollIntoView({ behavior: "smooth" });
      }
    }, 60);
  };

  const wordCount = useMemo(() => {
    const cjk = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    const words = (content.replace(/[\u4e00-\u9fff]/g, " ").match(/[a-zA-Z0-9_]+/g) || []).length;
    return cjk + words;
  }, [content]);

  const fmtSize = (n: number) =>
    n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`;

  if (!vaultReady) {
    return (
      <div className="app-shell">
        <WelcomeScreen />
        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      </div>
    );
  }

  const showEditor = viewMode === "edit" || viewMode === "split";
  const showPreview = viewMode === "preview" || viewMode === "split";

  return (
    <div className="app-shell">
      {/* 标题栏（macOS Overlay） */}
<div className="titlebar-drag" data-tauri-drag-region onMouseDown={dragWindow}>
          {isMac && <div style={{ width: 68 }} />}
          <div className="no-drag">
            <button className={`btn-icon${sidebarVisible ? " active" : ""}`} title={`侧栏 ${MOD}\\`} onClick={() => setStore({ sidebarVisible: !sidebarVisible })}>☰</button>
            <button className={`btn-icon${rightVisible ? " active" : ""}`} title="右侧面板" onClick={() => setStore({ rightVisible: !rightVisible })} style={{ marginLeft: 2 }}>◫</button>
            {!isMac && (
              <>
                <button className="btn-icon" title={`快速打开 ${MOD}P`} onClick={() => setQuickOpen(true)} style={{ marginLeft: 2 }}>🔍</button>
                <button className="btn-icon" title="设置" onClick={() => setSettingsOpen(true)} style={{ marginLeft: 2 }}>⚙️</button>
              </>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <div className="no-drag" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {externalPath ? `${externalPath.split(/[/\\]/).pop()}${dirty ? " •" : ""}` : currentRel ? `${currentRel.split("/").pop()}${dirty ? " •" : ""}` : "MarkdownX"}
          </div>
          <div style={{ flex: 1 }} />
          {isMac && (
            <div className="no-drag">
              <button className="btn-icon" title={`快速打开 ${MOD}P`} onClick={() => setQuickOpen(true)}>🔍</button>
              <button className="btn-icon" title="设置" onClick={() => setSettingsOpen(true)}>⚙️</button>
            </div>
          )}
        </div>

      <div className="main-area">
        {/* 左侧栏 */}
        {sidebarVisible && (
          <div className="sidebar no-print" style={{ width: sidebarWidth }}>
            <div className="sidebar-resizer no-print" onMouseDown={startSidebarResize} />
            <div className="sidebar-header">
              <input
                className="input"
                placeholder="过滤文件名…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                style={{ height: 28 }}
              />
            </div>
            <FileTree quickFilter={filter} />
          </div>
        )}

        {/* 中部 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div className="toolbar no-print">
            <button
              className="btn-icon"
              style={{ width: "auto", padding: "0 10px", fontSize: 12 }}
              title="新建笔记（在当前目录）"
              onClick={() => setNewNote("")}
            >
              ✚ 新建
            </button>
            <div className="sep" />
            {([
              ["edit", "✏️ 编辑"],
              ["split", "◫ 分栏"],
              ["preview", "👁 预览"],
              ["mindmap", "🗺 导图"],
              ["graph", "🕸 图谱"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                className={`btn-icon${viewMode === mode ? " active" : ""}`}
                style={{ width: "auto", padding: "0 10px", fontSize: 12 }}
                onClick={() => setStore({ viewMode: mode })}
              >
                {label}
              </button>
            ))}
            <div className="sep" />
            {externalPath || currentRel ? (
              <div className="file-title">
                <div className="title" title={externalPath ?? currentRel ?? ""}>{externalPath ? externalPath.split(/[/\\]/).pop() : currentRel}</div>
                <button
                  className="btn-icon"
                  title="关闭当前文件"
                  onClick={() => { void closeFile(); }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="title">未打开文件</div>
            )}
          </div>

          {externalChange && (
            <div style={{ padding: "6px 14px", background: "var(--bg-active)", fontSize: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <span>📂 检测到文件在外部被修改</span>
              <button className="btn" style={{ padding: "2px 10px" }} onClick={() => { void reloadCurrent(); setExternalChange(false); }}>重新加载</button>
              <button className="btn" style={{ padding: "2px 10px" }} onClick={() => setExternalChange(false)}>忽略</button>
            </div>
          )}

          {viewMode === "graph" ? (
            <GraphView />
          ) : viewMode === "mindmap" ? (
            <MindmapView dark={resolved === "dark"} />
          ) : (
            <div className="editor-pane" style={{ flex: 1 }}>
              {showEditor && (
                <div className="pane" style={{ borderRight: showPreview ? "none" : undefined }}>
                  {(currentRel || externalPath) ? (
                    <Editor
                      notes={notesGetter}
                      dark={resolved === "dark"}
                      syncRef={editorSyncRef}
                      syncLock={syncLock}
                      onScrollLine={syncEditorScroll}
                    />
                  ) : (
                    <EmptyHint />
                  )}
                </div>
              )}
              {showEditor && showPreview && <div className="pane-divider no-print" />}
              {showPreview && (
                <div className="pane">
                  {(currentRel || externalPath) ? (
                    <Preview
                      notes={notesGetter}
                      dark={resolved === "dark"}
                      syncRef={previewSyncRef}
                      syncLock={syncLock}
                      onScrollLine={syncPreviewScroll}
                    />
                  ) : (
                    <EmptyHint />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右侧栏 */}
        {rightVisible && (
          <div className="right-panel no-print" style={{ width: rightWidth }}>
            <div className="right-resizer no-print" onMouseDown={startRightResize} />
            <div className="panel-tabs">
              {([
                ["outline", "大纲"],
                ["backlinks", "链接"],
                ["ai", "AI 助手"],
              ] as const).map(([p, label]) => (
                <button key={p} className={rightPanel === (p as RightPanel) ? "active" : ""} onClick={() => setStore({ rightPanel: p as RightPanel })}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {rightPanel === "outline" && <OutlinePanel onJump={jumpToLine} />}
              {rightPanel === "backlinks" && <BacklinkPanel />}
              {rightPanel === "ai" && <AiPanel />}
            </div>
          </div>
        )}
      </div>

      {/* 状态栏 */}
      <div className="statusbar no-print">
        <span>{dirty ? "● 未保存（自动保存中…）" : "✓ 已保存"}</span>
        {externalPath && <span style={{ color: "var(--text-faint)" }}>外部文件 · 保存回原路径</span>}
        <span>{wordCount} 字</span>
        <span>{fmtSize(fileSize)}{largeFile ? " · 大文件模式" : ""}</span>
        <span>模型：{config?.aiModel || "deepseek-v4-flash"}</span>
        <div style={{ flex: 1 }} />
        <span>{MOD}P 快速打开 · {MOD}S 保存 · {MOD}\ 侧栏</span>
      </div>

      {newNote !== null && (
        <div className="quickopen-mask" onMouseDown={() => setNewNote(null)}>
          <div className="quickopen" style={{ width: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <input
              autoFocus
              className="input"
              placeholder={`新建笔记于：${currentRel?.split("/").slice(0, -1).join("/") || "知识库根目录"}`}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setNewNote(null);
                if (e.key === "Enter") void createNewNote();
              }}
              style={{ userSelect: "text" }}
            />
          </div>
        </div>
      )}
      {quickOpen && <QuickOpen onClose={() => setQuickOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** 绝对路径 → vault 相对路径；不在 vault 内返回 null */
function toVaultRel(vault: string, abs: string): string | null {
  const win = typeof window !== "undefined" && (window as any).electronAPI?.platform === "win32";
  const sep = win ? "\\" : "/";
  const v = vault.replace(/\//g, sep).replace(/[\\/]+$/, "");
  const a = abs.replace(/\//g, sep);
  if (a.toLowerCase() === v.toLowerCase()) return null;
  if (a.toLowerCase().startsWith(v.toLowerCase() + sep)) return a.slice(v.length + 1).replace(/\\/g, "/");
  return null;
}

function EmptyHint() {
  return (
    <div className="welcome">
      <div style={{ fontSize: 40 }}>📝</div>
      <div>从左侧选择或创建一篇笔记</div>
      <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{MOD}P 快速打开 · 粘贴图片自动归档 · [[链接]] 建立双链</div>
    </div>
  );
}

function WelcomeScreen() {
  const selectVault = useStore((s) => s.selectVault);
  const ref = useRef(false);
  useEffect(() => {
    if (ref.current) return;
    ref.current = true;
    // 首启自动引导选择知识库
  }, []);
  return (
    <div className="app-shell">
      <div className="welcome" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 56 }}>🗂</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: "var(--text)" }}>欢迎使用 DSH Markdown</div>
        <div style={{ maxWidth: 380, textAlign: "center", lineHeight: 1.8 }}>
          本地优先的智能 Markdown 知识库。选择一个文件夹作为你的知识库，
          笔记、附件、图片都会自动归类存放。
        </div>
        <button
          className="btn primary"
          style={{ padding: "10px 28px", fontSize: 15 }}
          onClick={async () => {
            try {
              let dir: string | null = null;
              if (typeof window !== "undefined" && (window as any).electronAPI) {
                dir = await (window as any).electronAPI.pickDirectory();
              } else {
                const { open } = await import("@tauri-apps/plugin-dialog");
                dir = await open({ directory: true, title: "选择或创建知识库目录" });
              }
              if (typeof dir === "string") await selectVault(dir);
            } catch (e) {
              alert(`打开目录选择框失败：${e}`);
            }
          }}
        >
          选择知识库目录
        </button>
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
          建议新建空目录，如 ~/Documents/dsh-notes
        </div>
      </div>
      <div className="statusbar">
        <span>未选择知识库</span>
        <div style={{ flex: 1 }} />
        <span>{MOD}P 快速打开 · {MOD}S 保存 · {MOD}\ 侧栏</span>
      </div>
    </div>
  );
}
