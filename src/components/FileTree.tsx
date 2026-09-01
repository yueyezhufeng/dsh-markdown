import { useEffect, useState, useCallback } from "react";
import { api, type FsNode } from "../lib/api";
import { useStore } from "../lib/store";
import { fuzzyScore } from "../lib/wikilink";

interface TreeState {
  [dir: string]: FsNode[];
}

/** 懒加载目录树：展开时才请求子级，10k 文件的知识库也不卡 */
export default function FileTree({ quickFilter }: { quickFilter: string }) {
  const treeVersion = useStore((s) => s.treeVersion);
  const currentRel = useStore((s) => s.currentRel);
  const openFile = useStore((s) => s.openFile);
  const bumpTree = useStore((s) => s.bumpTree);
  const refreshLinks = useStore((s) => s.refreshLinks);

  const [tree, setTree] = useState<TreeState>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; node: FsNode } | null>(null);
  const [editing, setEditing] = useState<{ rel: string; value: string; isNew: boolean; isDir: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDir = useCallback(async (dir: string) => {
    const nodes = await api.listDir(dir);
    setTree((t) => ({ ...t, [dir]: nodes }));
  }, []);

  useEffect(() => {
    void loadDir("");
    // treeVersion 变化时刷新已加载的目录
    setTree((t) => {
      Object.keys(t).forEach((d) => void loadDir(d));
      return t;
    });
  }, [treeVersion, loadDir]);

  const toggle = async (node: FsNode) => {
    const next = new Set(expanded);
    if (next.has(node.relPath)) {
      next.delete(node.relPath);
    } else {
      next.add(node.relPath);
      if (!tree[node.relPath]) await loadDir(node.relPath);
    }
    setExpanded(next);
  };

  const doCreate = async (parent: string, isDir: boolean) => {
    setEditing({ rel: parent, value: "", isNew: true, isDir });
  };

  const doRename = (node: FsNode) => {
    setEditing({ rel: node.relPath, value: node.name, isNew: false, isDir: node.isDir });
  };

  const doDelete = async (node: FsNode) => {
    if (!confirm(`确定删除「${node.name}」吗？（移入系统废纸篓，可恢复）`)) return;
    await api.deleteEntry(node.relPath);
    if (currentRel === node.relPath || currentRel?.startsWith(node.relPath + "/")) {
      useStore.setState({ currentRel: null, content: "", dirty: false });
    }
    bumpTree();
    refreshLinks();
  };

  const commitEdit = async () => {
    if (!editing) return;
    const name = editing.value.trim();
    try {
      if (editing.isNew) {
        if (!name) return;
        if (editing.isDir) await api.createDir(editing.rel, name);
        else await api.createNote(editing.rel, name);
      } else {
        if (!name) return;
        const newRel = await api.renameEntry(editing.rel, name);
        if (currentRel === editing.rel) useStore.setState({ currentRel: newRel });
      }
      bumpTree();
      refreshLinks();
    } catch (e) {
      alert(String(e));
    }
    setEditing(null);
  };

  // 展示过滤：快速过滤时做模糊匹配（对已加载目录 + 全量兜底走搜索面板）
  const filterNodes = (nodes: FsNode[]): FsNode[] => {
    if (!quickFilter) return nodes;
    return nodes.filter((n) => fuzzyScore(quickFilter, n.name) > 0 || n.isDir);
  };

  const renderNodes = (dir: string, depth: number): React.ReactNode => {
    const nodes = filterNodes(tree[dir] ?? []);
    return nodes.map((node) => {
      const isOpen = expanded.has(node.relPath);
      const isMd = /\.md$/i.test(node.name);
      const isActive = currentRel === node.relPath;
      const ed = editing !== null && editing.rel === node.relPath && !editing.isNew ? editing : null;
      return (
        <div key={node.relPath}>
          {ed ? (
            <div style={{ paddingLeft: depth * 14 + 24 }}>
              <input
                className="input"
                autoFocus
                value={ed.value}
                onChange={(e) => setEditing({ ...ed, value: e.target.value })}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitEdit();
                  if (e.key === "Escape") setEditing(null);
                }}
                style={{ height: 26, margin: "2px 6px", width: "calc(100% - 12px)" }}
                onFocus={(e) => e.target.select()}
              />
            </div>
          ) : (
            <div
              className={`tree-row${isActive ? " active" : ""}`}
              style={{ paddingLeft: depth * 14 + 6 }}
              onClick={() => (node.isDir ? void toggle(node) : isMd && void openFile(node.relPath))}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, node });
              }}
            >
              <span className="tree-arrow" style={{ width: 16, display: "inline-block", textAlign: "center", color: "var(--text-faint)" }}>
                {node.isDir ? (isOpen ? "▾" : "▸") : ""}
              </span>
              <span style={{ marginRight: 6 }}>{node.isDir ? (isOpen ? "📂" : "📁") : isMd ? "📝" : "📎"}</span>
              <span className="tree-label" title={node.relPath}>{node.name}</span>
            </div>
          )}
          {node.isDir && isOpen && (
            <div>
              {tree[node.relPath] === undefined ? (
                <div style={{ paddingLeft: (depth + 1) * 14 + 28, color: "var(--text-faint)", fontSize: 12 }}>加载中…</div>
              ) : (
                renderNodes(node.relPath, depth + 1)
              )}
              {editing?.isNew && editing.rel === node.relPath && renderInlineInput(depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  const renderInlineInput = (depth: number) => (
    <div style={{ paddingLeft: depth * 14 + 24 }}>
      <input
        className="input"
        autoFocus
        placeholder={editing?.isDir ? "文件夹名" : "笔记名"}
        value={editing?.value ?? ""}
        onChange={(e) => editing && setEditing({ ...editing, value: e.target.value })}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commitEdit();
          if (e.key === "Escape") setEditing(null);
        }}
        style={{ height: 26, margin: "2px 6px", width: "calc(100% - 12px)" }}
      />
    </div>
  );

  // 根级新建输入框
  const rootInput = editing?.isNew && editing.rel === "" ? renderInlineInput(0) : null;

  return (
    <div className="file-tree" style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
      {loading && <div style={{ padding: 8, color: "var(--text-faint)", fontSize: 12 }}>加载中…</div>}
      {renderNodes("", 0)}
      {rootInput}
      {menu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="ctx-menu" style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 41, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "var(--shadow)", padding: 4, minWidth: 160 }}>
            {menu.node.isDir && (
              <>
                <button className="ctx-item" onClick={() => { setMenu(null); doCreate(menu.node.relPath, false); }}>📝 新建笔记</button>
                <button className="ctx-item" onClick={() => { setMenu(null); doCreate(menu.node.relPath, true); }}>📁 新建文件夹</button>
                <div style={{ height: 1, background: "var(--border)", margin: "4px 8px" }} />
              </>
            )}
            {!menu.node.isDir && (
              <button className="ctx-item" onClick={() => { setMenu(null); void openFile(menu.node.relPath); }}>打开</button>
            )}
            <button className="ctx-item" onClick={() => { const n = menu.node; setMenu(null); doRename(n); }}>✏️ 重命名</button>
            <button className="ctx-item danger" onClick={() => { const n = menu.node; setMenu(null); void doDelete(n); }}>🗑 删除</button>
          </div>
        </>
      )}
    </div>
  );
}
