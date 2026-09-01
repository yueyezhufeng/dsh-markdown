import { useEffect, useMemo, useRef } from "react";
import { renderMarkdown, ensurePrism } from "../lib/markdown";
import { useStore } from "../lib/store";
import type { NoteMeta } from "../lib/cm";
import { mmTextStyle } from "./MindmapView";
import type { ScrollSyncLock, ScrollSyncRef } from "../lib/scroll-sync";

/** mermaid 动态加载缓存（首次用到才 import，约 1MB，空闲不占内存） */
let mermaidPromise: Promise<typeof import("mermaid")> | null = null;
let mermaidInitedTheme: string | null = null; // initialize 全局生效，重复调用会导致后续 render 偶发失败
function loadMermaid() {
  mermaidPromise ??= import("mermaid");
  return mermaidPromise;
}
let mmPromise: Promise<{ Transformer: typeof import("markmap-lib").Transformer; Markmap: typeof import("markmap-view").Markmap }> | null = null;
function loadMarkmap() {
  mmPromise ??= Promise.all([import("markmap-lib"), import("markmap-view")]).then(
    ([lib, view]) => ({ Transformer: lib.Transformer, Markmap: view.Markmap })
  );
  return mmPromise;
}

interface PreviewProps {
  notes: () => NoteMeta[];
  dark: boolean;
  syncRef?: ScrollSyncRef;
  syncLock?: ScrollSyncLock;
  onScrollLine?: (line: number) => void;
}

export default function Preview({ notes, dark, syncRef, syncLock, onScrollLine }: PreviewProps) {
  const content = useStore((s) => s.content);
  const config = useStore((s) => s.config);
  const treeVersion = useStore((s) => s.treeVersion);
  const largeFile = useStore((s) => s.largeFile);
  const currentRel = useStore((s) => s.currentRel);
  const openFile = useStore((s) => s.openFile);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const vault = config?.vaultPath ?? "";

  // 大文件不渲染（性能保护）
  const html = useMemo(() => {
    if (largeFile) return "";
    void treeVersion; // 文件增删后刷新链接存在状态
    return renderMarkdown(content, vault);
  }, [content, vault, largeFile, treeVersion]);

  // 渲染后：高亮已由 md 处理；处理 mermaid / markmap 块
  useEffect(() => {
    const root = hostRef.current;
    if (!root || !html) return;
    let cancelled = false;

    const mermaidEls = Array.from(root.querySelectorAll<HTMLElement>('.diagram[data-diagram="mermaid"]'));
    const markmapEls = Array.from(root.querySelectorAll<HTMLElement>('.diagram[data-diagram="markmap"]'));

    if (mermaidEls.length) {
      void loadMermaid().then(async (m) => {
        if (cancelled) return;
        const theme = dark ? "dark" : "default";
        if (mermaidInitedTheme !== theme) {
          m.default.initialize({ startOnLoad: false, theme, securityLevel: "loose" });
          mermaidInitedTheme = theme;
        }
        for (let i = 0; i < mermaidEls.length; i++) {
          const el = mermaidEls[i];
          const src = el.querySelector(".diagram-src")?.textContent ?? "";
          try {
            const { svg } = await m.default.render(`mmd-${Date.now()}-${i}`, src);
            if (!cancelled) el.innerHTML = svg;
          } catch (e) {
            if (!cancelled) {
              el.innerHTML = `<div class="diagram-error">mermaid 语法错误：${String(e).slice(0, 200)}</div>`;
            }
          }
        }
      });
    }

    if (markmapEls.length) {
      void loadMarkmap().then(async ({ Transformer, Markmap }) => {
        if (cancelled) return;
        for (let i = 0; i < markmapEls.length; i++) {
          const el = markmapEls[i];
          const src = el.querySelector(".diagram-src")?.textContent ?? "";
          try {
            const transformer = new Transformer();
            const { root: mmRoot } = transformer.transform(src);
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("style", "width:100%;min-height:320px");
            el.innerHTML = "";
            el.appendChild(svg);
            Markmap.create(svg, { autoFit: true, style: () => mmTextStyle(dark) }, mmRoot);
          } catch (e) {
            el.innerHTML = `<div class="diagram-error">markmap 解析失败：${String(e).slice(0, 200)}</div>`;
          }
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [html, dark]);

  // wikilink 点击：存在则打开，不存在则创建
  useEffect(() => {
    const root = hostRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a.wikilink");
      if (!a) return;
      e.preventDefault();
      const target = a.getAttribute("data-target") ?? "";
      if (!target) return;
      const all = notes();
      const base = target.toLowerCase();
      const hit = all.find(
        (n) =>
          n.relPath.toLowerCase() === `${base}.md` ||
          n.relPath.replace(/\.md$/i, "").toLowerCase() === base
      );
      if (hit) {
        void openFile(hit.relPath);
      } else {
        // 不存在 → 创建笔记（Obsidian 式体验）
        const dir = useStore.getState().currentRel?.split("/").slice(0, -1).join("/") ?? "";
        import("../lib/api").then(async ({ api }) => {
          const rel = await api.createNote(dir, target);
          useStore.getState().bumpTree();
          await useStore.getState().openFile(rel);
          useStore.getState().refreshLinks();
        });
      }
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [notes, openFile]);

  // 首次渲染前加载 prism（后台）
  useEffect(() => {
    void ensurePrism();
  }, []);

  // 切换文件时预览滚回顶部（与编辑器对齐）
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [currentRel]);

  // 分栏滚动同步：预览滚动 → 上报顶部可见标题所在行
  useEffect(() => {
    const scroller = scrollRef.current;
    const root = hostRef.current;
    if (!scroller || !root) return;
    let raf = 0;
    let lastLine = 0;
    const report = () => {
      raf = 0;
      if (syncLock?.current) return;
      const heads = root.querySelectorAll<HTMLElement>("[data-line]");
      let top: HTMLElement | null = null;
      const topY = scroller.scrollTop + 12;
      for (const h of Array.from(heads)) {
        if (h.offsetTop <= topY) top = h;
        else break;
      }
      if (top) {
        const line = Number(top.dataset.line) + 1;
        if (line !== lastLine) {
          lastLine = line;
          onScrollLine?.(line);
        }
      }
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(report);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    if (syncRef) {
      syncRef.current = {
        scrollToLine: (line: number) => {
          if (syncLock?.current) return;
          if (syncLock) syncLock.current = true;
          const target = line - 1;
          const heads = root.querySelectorAll<HTMLElement>("[data-line]");
          let el: HTMLElement | null = null;
          for (const h of Array.from(heads)) {
            if (Number(h.dataset.line) <= target) el = h;
            else break;
          }
          if (el) scroller.scrollTop = el.offsetTop - 8;
          window.setTimeout(() => {
            if (syncLock) syncLock.current = false;
          }, 40);
        },
      };
    }
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
      if (syncRef) syncRef.current = null;
    };
  }, [html, syncRef, syncLock, onScrollLine]);

  if (largeFile) {
    return (
      <div className="preview-pane" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 32 }}>📄</div>
        <div>大文件模式（&gt;2MB）：预览已停用以保持流畅</div>
        <div style={{ fontSize: 12 }}>可正常编辑、保存、导出</div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="preview-pane" style={{ overflowY: "auto", height: "100%", padding: "24px 32px" }}>
      <div
        ref={hostRef}
        className="md-preview"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
