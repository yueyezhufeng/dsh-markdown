import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import { convertFileSrc } from "./file-src";

/** mermaid / markmap 动态加载状态缓存（首次用到才 import，降低空闲内存） */
let prismLoaded = false;

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

// ---------- [[wikilink]] inline 规则 ----------
md.inline.ruler.before("link", "wikilink", (state, silent) => {
  const src = state.src;
  const pos = state.pos;
  if (src[pos] !== "[" || src[pos + 1] !== "[") return false;
  if (pos > 0 && src[pos - 1] === "!") return false;
  const end = src.indexOf("]]", pos + 2);
  if (end < 0) return false;
  const inner = src.slice(pos + 2, end).trim();
  if (!inner || inner.includes("[")) return false;
  if (!silent) {
    const [target, alias] = inner.split("|");
    const token = state.push("wikilink", "", 0);
    token.meta = { target: target.trim(), alias: alias?.trim() || target.trim() };
  }
  state.pos = end + 2;
  return true;
});

type RenderRule = (tokens: Token[], idx: number) => string;
const rules = md.renderer.rules as unknown as Record<string, RenderRule>;
rules["wikilink"] = (tokens, idx) => {
  const { target, alias } = tokens[idx].meta as { target: string; alias: string };
  const safe = target.replace(/"/g, "&quot;");
  const label = alias.replace(/</g, "&lt;");
  return `<a class="wikilink" data-target="${safe}" href="#">${label}</a>`;
};

// ---------- 代码块：高亮 + mermaid/markmap 占位 ----------
md.set({
  highlight(code, lang) {
    const language = (lang || "").trim().toLowerCase();
    if (language === "mermaid" || language === "markmap" || language === "mindmap") return "";
    return highlightCode(code, language);
  },
});

const fenceDefault = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const lang = (token.info || "").trim().toLowerCase();
  if (lang === "mermaid") {
    const src = md.utils.escapeHtml(token.content);
    return `<div class="diagram" data-diagram="mermaid"><pre class="diagram-src">${src}</pre></div>`;
  }
  if (lang === "markmap" || lang === "mindmap") {
    const src = md.utils.escapeHtml(token.content);
    return `<div class="diagram" data-diagram="markmap"><pre class="diagram-src">${src}</pre></div>`;
  }
  return fenceDefault(tokens, idx, options, env, self);
};

// ---------- 标题：附行号（大纲跳转定位用） ----------
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const map = token.map;
  if (map) token.attrSet("data-line", String(map[0]));
  return self.renderToken(tokens, idx, options);
};

// ---------- 图片：vault 相对路径 → file:// URL ----------
const imageDefault = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const srcIdx = token.attrIndex("src");
  if (srcIdx >= 0) {
    const value = token.attrs![srcIdx][1] as string;
    const vault = (env as { vault?: string }).vault;
    if (vault && !/^(https?:|data:|#|file:)/.test(value)) {
      const abs = `${vault.replace(/\/$/, "")}/${value.replace(/^\.\//, "").replace(/^\//, "")}`;
      token.attrs![srcIdx][1] = convertFileSrc(abs);
    }
  }
  return imageDefault(tokens, idx, options, env, self);
};

/** prism 按需加载 + 高亮（加载前退化为纯文本，加载后下次渲染生效） */
export async function ensurePrism() {
  if (prismLoaded) return;
  prismLoaded = true;
  const Prism = (await import("prismjs")).default;
  await Promise.all([
    import("prismjs/components/prism-javascript"),
    import("prismjs/components/prism-typescript"),
    import("prismjs/components/prism-jsx"),
    import("prismjs/components/prism-tsx"),
    import("prismjs/components/prism-python"),
    import("prismjs/components/prism-rust"),
    import("prismjs/components/prism-bash"),
    import("prismjs/components/prism-json"),
    import("prismjs/components/prism-yaml"),
    import("prismjs/components/prism-sql"),
    import("prismjs/components/prism-toml"),
    import("prismjs/components/prism-markup"),
    import("prismjs/components/prism-css"),
    import("prismjs/components/prism-go"),
    import("prismjs/components/prism-java"),
  ]).catch(() => {});
  (globalThis as Record<string, unknown>).__prism = Prism;
}

export function highlightCode(code: string, lang: string): string {
  const prism = (globalThis as Record<string, unknown>).__prism as
    | { languages: Record<string, unknown>; highlight: (c: string, l: string) => string }
    | undefined;
  if (prism && lang && prism.languages[lang]) {
    try {
      return prism.highlight(code, lang);
    } catch { /* 降级 */ }
  }
  return md.utils.escapeHtml(code);
}

/** 渲染 markdown → html（env.vault 用于图片路径解析） */
export function renderMarkdown(text: string, vault: string): string {
  return md.render(text, { vault });
}