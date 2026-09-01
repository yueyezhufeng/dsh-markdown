import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { createExtensions, type NoteMeta } from "../lib/cm";
import { useStore } from "../lib/store";
import type { ScrollSyncLock, ScrollSyncRef } from "../lib/scroll-sync";

interface EditorProps {
  notes: () => NoteMeta[];
  dark: boolean;
  syncRef?: ScrollSyncRef;
  syncLock?: ScrollSyncLock;
  onScrollLine?: (line: number) => void;
}

/**
 * CodeMirror 6 编辑器。
 * 视口增量渲染：10MB+ 文档也只渲染可见区域（大文件的关键）。
 * 外部内容变更（跳转/重载）通过重建 state 同步。
 * 分栏模式下与预览双向滚动联动（syncRef / syncLock / onScrollLine）。
 */
export default function Editor({ notes, dark, syncRef, syncLock, onScrollLine }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const content = useStore((s) => s.content);
  const currentRel = useStore((s) => s.currentRel);
  const updateContent = useStore((s) => s.updateContent);
  const bumpTree = useStore((s) => s.bumpTree);

  // 文档切换 / 外部替换 → 重建
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          ...createExtensions({
            dark,
            notes,
            currentDir: () => "",
            onAttachmentSaved: () => bumpTree(),
          }),
          EditorView.updateListener.of((v) => {
            if (v.docChanged) updateContent(v.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;

    // 分栏滚动同步：编辑器滚动 → 上报可见行
    let raf = 0;
    let lastLine = 0;
    const onScroll = () => {
      if (syncLock?.current) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
        const line = view.state.doc.lineAt(block.from).number;
        if (line !== lastLine) {
          lastLine = line;
          onScrollLine?.(line);
        }
      });
    };
    if (syncRef) {
      view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
      syncRef.current = {
        scrollToLine: (n: number) => {
          if (syncLock?.current) return;
          if (syncLock) syncLock.current = true;
          const line = Math.max(1, Math.min(n, view.state.doc.lines));
          const pos = view.state.doc.line(line).from;
          view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 4 }) });
          window.setTimeout(() => {
            if (syncLock) syncLock.current = false;
          }, 40);
        },
      };
      // 打开/切换文件后让两侧对齐到顶部
      onScrollLine?.(1);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (syncRef) {
        view.scrollDOM.removeEventListener("scroll", onScroll);
        syncRef.current = null;
      }
      view.destroy();
      viewRef.current = null;
    };
    // 仅在文件切换时重建编辑器实例；主题变化通过重建亦可接受（少见操作）
  }, [currentRel, dark]);

  // store → editor（外部内容变更：reload/跳转）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      });
    }
  }, [content]);

  return <div ref={hostRef} className="editor-host" style={{ height: "100%", overflow: "hidden" }} />;
}
