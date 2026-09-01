import type { MutableRefObject } from "react";

/** 分栏滚动同步的编程式控制句柄 */
export interface ScrollSyncHandle {
  /** 滚动到指定行（1-based，预览按最近标题锚定） */
  scrollToLine: (line: number) => void;
}

/** 编辑器/预览对外暴露的同步句柄引用 */
export type ScrollSyncRef = MutableRefObject<ScrollSyncHandle | null>;

/** 双向同步锁：程序化滚动期间抑制对方回弹 */
export type ScrollSyncLock = MutableRefObject<boolean>;