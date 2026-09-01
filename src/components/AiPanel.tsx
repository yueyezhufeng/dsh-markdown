import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { aiChat, type AiMessage, type TextPart, type ImagePart } from "../lib/ai";
import { renderMarkdown } from "../lib/markdown";
import { api, type ChatSummary } from "../lib/api";
import { MOD } from "../lib/platform";
import { IconClock, IconPlus, IconSend, IconImage, IconCamera, IconGlobe, IconClose } from "./icons";

interface Msg {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  error?: string;
}

const CTX_LIMIT = 8000;
const MAX_IMAGES = 4;
/** 网页剪藏固定目录与格式（对齐 Obsidian Web Clipper 习惯） */
const CLIPPINGS_DIR = "Clippings";

function newChatId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AiPanel() {
  const config = useStore((s) => s.config);
  const currentRel = useStore((s) => s.currentRel);
  const content = useStore((s) => s.content);
  const openFile = useStore((s) => s.openFile);
  const bumpTree = useStore((s) => s.bumpTree);
  const refreshLinks = useStore((s) => s.refreshLinks);

  const [chatId, setChatId] = useState(newChatId());
  const [chatTitle, setChatTitle] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [withCtx, setWithCtx] = useState(true);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ChatSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [shotBusy, setShotBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const isUrl = /^https?:\/\/\S+$/i.test(input.trim());
  const hasImages = images.length > 0;
  const visionModel = config?.aiVisionModel || "deepseek-v4-flash-vision-exp";

  // 主按钮模式：链接转笔记 > 图片转笔记 > 普通发送
  const primaryMode: "url" | "image" | "send" = isUrl ? "url" : hasImages && !input.trim() ? "image" : "send";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, images]);

  useEffect(() => {
    void api.aiChatList().then(setHistory).catch(() => setHistory([]));
  }, []);

  const persist = async (msgs: Msg[], title: string) => {
    try {
      await api.aiChatSave({
        id: chatId,
        title: title || "新会话",
        modified: Date.now(),
        messages: msgs.map((m) => ({ role: m.role, content: m.content, images: m.images ?? [] })),
      });
      void api.aiChatList().then(setHistory).catch(() => {});
    } catch {
      /* 忽略 */
    }
  };

  const ensureConfig = () => {
    if (!config?.aiApiKey) {
      alert("请先在设置中填写 DeepSeek API Key（右上角 ⚙️）");
      return false;
    }
    return true;
  };

  const aiChatWithModel = async (
    model: string,
    cfg: NonNullable<typeof config>,
    msgs: AiMessage[],
    onFull: (full: string) => void,
    maxTokens?: number
  ) => {
    await aiChat({ ...cfg, aiModel: model } as never, msgs, (_d, full) => onFull(full), maxTokens);
  };

  const toApiMessages = (msgs: Msg[]): AiMessage[] => {
    const out: AiMessage[] = [
      {
        role: "system",
        content: "你是 DSH Markdown 知识库的 AI 助手，擅长整理笔记、写作与知识管理。回答简洁准确，使用 Markdown 格式。",
      },
    ];
    if (withCtx && currentRel) {
      const doc = content.length > CTX_LIMIT ? content.slice(0, CTX_LIMIT) + "\n…(已截断)" : content;
      out.push({ role: "system", content: `当前打开的笔记《${currentRel}》内容：\n\n${doc}` });
    }
    for (const m of msgs.slice(-12)) {
      if (m.images?.length) {
        const parts: (TextPart | ImagePart)[] = [{ type: "text", text: m.content || "请看这些图片" }];
        for (const url of m.images) parts.push({ type: "image_url", image_url: { url } });
        out.push({ role: m.role, content: parts });
      } else {
        out.push({ role: m.role, content: m.content });
      }
    }
    return out;
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !hasImages) || busy || !config) return;
    if (!ensureConfig()) return;
    const useVision = hasImages;
    const userMsg: Msg = { role: "user", content: text, images: useVision ? images : undefined };
    const nextMessages = [...messages, userMsg, { role: "assistant" as const, content: "" }];
    const title = chatTitle || text.slice(0, 24) || "图片对话";
    setMessages(nextMessages);
    setChatTitle(title);
    setInput("");
    setImages([]);
    setBusy(true);
    try {
      const apiMsgs = toApiMessages(nextMessages.slice(0, -1));
      if (useVision) {
        apiMsgs.push({
          role: "user",
          content: [
            { type: "text", text: text || "请解读这些图片" },
            ...userMsg.images!.map((url) => ({ type: "image_url", image_url: { url } }) as ImagePart),
          ],
        });
      }
      await aiChatWithModel(useVision ? visionModel : config.aiModel, config, apiMsgs, (full) => {
        setMessages((ms) => ms.map((x, i) => (i === ms.length - 1 ? { ...x, content: full } : x)));
      });
      setMessages((ms) => {
        void persist(ms, title);
        return ms;
      });
    } catch (e) {
      setMessages((ms) => {
        const fixed = ms.map((x, i) => (i === ms.length - 1 ? { ...x, error: String(e) } : x));
        void persist(fixed, title);
        return fixed;
      });
    } finally {
      setBusy(false);
    }
  };

  const addClipboardImages = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, MAX_IMAGES);
    for (const f of imgs) {
      const reader = new FileReader();
      reader.onload = () => setImages((arr) => (arr.length >= MAX_IMAGES ? arr : [...arr, String(reader.result)]));
      reader.readAsDataURL(f);
    }
  };

  /** 网页 → Markdown 剪藏（Clippings 格式：front-matter + 分节正文 + 本地化配图） */
  const urlToNote = async () => {
    const url = input.trim();
    if (!config || !ensureConfig()) return;
    setBusy(true);
    const title = `🌐 ${url.slice(0, 40)}`;
    setMessages((m) => [...m, { role: "user", content: url }, { role: "assistant", content: "" }]);
    setChatTitle(chatTitle || title);
    setInput("");
    const update = (full: string) =>
      setMessages((ms) => ms.map((x, i) => (i === ms.length - 1 ? { ...x, content: full } : x)));
    try {
      update("⏳ 抓取网页中…");
      const page = await api.fetchPage(url);
      const isJsRendered =
        /docs\.qq\.com|shimo\.im|feishu\.cn|notion\.so|yuque\.com/i.test(url) ||
        page.text.replace(/\s/g, "").length < 120;
      if (isJsRendered) {
        update(
          "⚠️ 该页面由 JavaScript 动态渲染（腾讯文档/飞书/Notion 等），无法直接抓取。\n\n**一键替代**：点下方 📷 按钮截图，会自动用视觉模型把截图转成 Markdown 笔记（无需粘贴）。"
        );
        return;
      }
      update(
        `⏳ 已获取「${page.title}」（正文 ${page.text.length} 字${page.images.length ? `，配图 ${page.images.length} 张` : ""}），AI 整理中…`
      );
      let localImages: string[] = [];
      if (page.images.length) {
        localImages = await api.downloadImages(page.images).catch(() => []);
      }
      let full = "";
      await aiChatWithModel(
        config.aiModel,
        config,
        [
          {
            role: "system",
            content:
              "你是网页内容整理器。把网页文本整理为结构清晰的中文 Markdown 笔记：1) 首行是「## 网页标题」；2) 接着 1-2 句摘要；3) 正文按逻辑分节（###），保留关键事实、数据、表格与列表；4) 剔除广告、导航、版权等噪音；5) 直接输出 Markdown 正文，不要解释。",
          },
          { role: "user", content: `来源：${url}\n标题：${page.title}\n\n网页文本：\n${page.text.slice(0, 30000)}` },
        ],
        (f) => {
          full = f;
          update(f);
        },
        8192
      );
      if (!full.trim()) {
        update("⚠️ 模型未返回内容，请重试。");
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const desc = (page.text.replace(/\s+/g, " ").trim().slice(0, 100) || page.title).replace(/"/g, "'") + (page.text.length > 100 ? "…" : "");
      const fm = [
        "---",
        `title: "${(page.title || url).replace(/"/g, "'")}"`,
        `source: "${url}"`,
        "author:",
        "published:",
        `created: ${today}`,
        `description: "${desc}"`,
        "tags:",
        '  - "clippings"',
        "---",
        "",
      ].join("\n");
      let body = fm + full;
      if (localImages.length) {
        body += `\n\n## 配图\n\n${localImages.map((rel, i) => `![${i + 1}](${encodeURI(rel)})`).join("\n\n")}\n`;
      }
      const rel = await api.createNote(CLIPPINGS_DIR, page.title || "网页剪藏", body);
      bumpTree();
      refreshLinks();
      update(`${full}\n\n---\n✅ 已保存：**${rel}**${localImages.length ? `（配图 ${localImages.length} 张已本地化）` : ""}`);
      await openFile(rel);
    } catch (e) {
      setMessages((ms) => ms.map((x, i) => (i === ms.length - 1 ? { ...x, error: String(e) } : x)));
    } finally {
      setBusy(false);
    }
  };

  /** 图片 → Markdown 笔记（Vision 模型）；imgs 显式传入（截图/选图自动流程用） */
  const imageToNote = async (imgs?: string[]) => {
    const pics = imgs ?? images;
    if (!pics.length || !config || !ensureConfig()) return;
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: "🖼 转笔记", images: [...pics] }, { role: "assistant", content: "" }]);
    setImages([]);
    const update = (full: string) =>
      setMessages((ms) => ms.map((x, i) => (i === ms.length - 1 ? { ...x, content: full } : x)));
    try {
      update("⏳ 视觉模型解析图片…");
      const mkParts = (extra: string): (TextPart | ImagePart)[] => [
        {
          type: "text",
          text:
            "把图片内容整理为一篇结构清晰的中文 Markdown 笔记：表格逐行转为 Markdown 表格、列表转列表、标题层级合理；保留全部关键信息；首行用「## 主题」概括；直接输出 Markdown 正文，不要解释。" +
            extra,
        },
        ...pics.map((url) => ({ type: "image_url", image_url: { url } }) as ImagePart),
      ];
      let full = "";
      // 第一轮
      await aiChatWithModel(visionModel, config, [{ role: "user", content: mkParts("") }], (f) => {
        full = f;
        update(f);
      }, 8192);
      // 推理模型偶发把结果全写进思考过程导致正文为空 → 换强化提示自动重试一次
      if (!full.trim()) {
        update("⏳ 首次输出正文为空，自动重试…");
        await aiChatWithModel(
          visionModel,
          config,
          [
            {
              role: "user",
              content: mkParts("\n\n【重要】最终回复正文（content）必须包含完整的 Markdown 笔记内容；不要只写在思考过程里。"),
            },
          ],
          (f) => {
            full = f;
            update(f);
          },
          8192
        );
      }
      if (!full.trim()) {
        update("⚠️ 两次尝试模型均未产出正文（内容可能过于复杂），请重试或分段截图。");
        return;
      }
      const titleMatch = /^##\s+(.+)$/m.exec(full);
      const noteTitle = (titleMatch?.[1] ?? `图片笔记 ${new Date().toLocaleDateString()}`).slice(0, 50);
      const today = new Date().toISOString().slice(0, 10);
      const fm = `---\ncreated: ${today}\ntags:\n  - "image-note"\n---\n\n`;
      const rel = await api.createNote(CLIPPINGS_DIR, noteTitle, fm + full);
      bumpTree();
      refreshLinks();
      update(`${full}\n\n---\n✅ 已保存：**${rel}**`);
      await openFile(rel);
    } catch (e) {
      setMessages((ms) => ms.map((x, i) => (i === ms.length - 1 ? { ...x, error: String(e) } : x)));
    } finally {
      setBusy(false);
    }
  };

  /** 系统交互截图 → 自动转笔记（一步到位） */
  const takeScreenshot = async () => {
    if (shotBusy || busy) return;
    if (!config?.aiApiKey) {
      ensureConfig();
      return;
    }
    setShotBusy(true);
    try {
      const b64 = await api.interactiveScreenshot();
      if (b64) {
        const dataUrl = `data:image/png;base64,${b64}`;
        await imageToNote([dataUrl]); // 截图即转笔记
      }
    } catch (e) {
      alert(`截图失败：${e}\n\n首次使用请在 系统设置 → 隐私与安全性 → 屏幕录制 中允许 DSH Markdown`);
    } finally {
      setShotBusy(false);
    }
  };

  /** 选择图片文件 → 自动转笔记 */
  const pickImage = async () => {
    let imgs: string[] = [];
    if (typeof window !== "undefined" && (window as any).electronAPI) {
      imgs = await (window as any).electronAPI.pickImages();
      if (imgs.length) {
        setImages((arr) => [...arr, ...imgs].slice(0, MAX_IMAGES));
        await imageToNote(imgs); // 选图即转笔记
      }
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const files = await open({
      multiple: true,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (!Array.isArray(files) || !files.length) return;
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    for (const f of files.slice(0, MAX_IMAGES)) {
      try {
        const blob = await fetch(convertFileSrc(f)).then((r) => r.blob());
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });
        imgs.push(dataUrl);
      } catch {
        /* 单个失败跳过 */
      }
    }
    if (imgs.length) {
      setImages((arr) => [...arr, ...imgs].slice(0, MAX_IMAGES));
      await imageToNote(imgs); // 选图即转笔记
    }
  };

  const newSession = () => {
    if (messages.length) void persist(messages, chatTitle);
    setChatId(newChatId());
    setChatTitle("");
    setMessages([]);
    setInput("");
    setImages([]);
  };

  const loadSession = async (id: string) => {
    if (messages.length) void persist(messages, chatTitle);
    try {
      const doc = await api.aiChatLoad(id);
      setChatId(doc.id);
      setChatTitle(doc.title);
      setMessages(
        (doc.messages as { role: "user" | "assistant"; content: string; images?: string[] }[]).map((m) => ({
          role: m.role,
          content: String(m.content ?? ""),
          images: m.images,
        }))
      );
      setShowHistory(false);
    } catch (e) {
      alert(String(e));
    }
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("删除该会话？")) return;
    await api.aiChatDelete(id);
    if (id === chatId) newSession();
    void api.aiChatList().then(setHistory);
  };

  const primaryAction = () => {
    if (primaryMode === "url") return void urlToNote();
    if (primaryMode === "image") return void imageToNote();
    return void send();
  };

  return (
    <div className="ai-panel">
      {/* 会话栏：标题居左，时钟/加号相邻居右 */}
      <div className="ai-chat-bar">
        <div className="ai-chat-title" title={chatTitle}>
          {chatTitle || "新会话"}
        </div>
        <button
          className={`btn-icon${showHistory ? " active" : ""}`}
          title="历史会话"
          onClick={() => setShowHistory((v) => !v)}
        >
          <IconClock />
        </button>
        <button className="btn-icon" title="新建会话" onClick={newSession}>
          <IconPlus />
        </button>
      </div>

      {showHistory && (
        <div className="ai-history">
          <div className="ai-history-head">历史会话</div>
          <div className="ai-history-list">
            {history.length === 0 && <div className="ai-history-empty">暂无历史会话</div>}
            {history.map((h) => (
              <div key={h.id} className="ai-history-item" onClick={() => void loadSession(h.id)}>
                <div className="ai-history-title">{h.title || "未命名"}</div>
                <div className="ai-history-time">{new Date(h.modified).toLocaleString()}</div>
                <button className="ai-history-del" onClick={(e) => void deleteSession(h.id, e)} title="删除">
                  <IconClose size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ai-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="ai-hint">
            <div>💡 直接提问（可携带当前笔记上下文）</div>
            <div>🌐 粘贴链接回车 → 一键转笔记（微信文章含配图）</div>
            <div>📷 截图 / 选图 → 自动转 Markdown 笔记</div>
            <div style={{ marginTop: 6, opacity: 0.7 }}>
              {config?.aiModel} · 视觉 {visionModel}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-bubble ${m.role}`}>
            {m.role === "user" && m.images?.length ? (
              <div className="ai-msg-images">
                {m.images.map((url, j) => (
                  <img key={j} src={url} alt="" />
                ))}
              </div>
            ) : null}
            {m.role === "assistant" && m.content ? (
              <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content, config?.vaultPath ?? "") }} />
            ) : (
              m.content || "…"
            )}
            {m.error && <div className="ai-error">⚠ {m.error}</div>}
          </div>
        ))}
      </div>

      {/* 输入区：图片 chips → 输入框 → 工具行（工具按钮 + 智能主按钮） */}
      <div className="ai-composer">
        {hasImages && (
          <div className="ai-chips">
            {images.map((url, i) => (
              <div key={i} className="ai-chip">
                <img src={url} alt="" />
                <button className="ai-chip-x" onClick={() => setImages((a) => a.filter((_, j) => j !== i))}>
                  <IconClose size={9} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          className="ai-textarea"
          rows={3}
          placeholder={
            isUrl
              ? `已识别链接，点右侧按钮或 ${MOD}↩ 一键转笔记`
              : withCtx && currentRel
              ? "提问（携带当前笔记）… 可粘贴图片/链接"
              : "提问… 可粘贴图片/链接"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
            if (files.length) {
              e.preventDefault();
              addClipboardImages(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              primaryAction();
            }
            if (e.key === "Enter" && !e.shiftKey && isUrl && input.trim()) {
              e.preventDefault();
              primaryAction();
            }
          }}
        />
        <div className="ai-actions">
          <button
            className={`ai-pill${withCtx && currentRel ? " on" : ""}`}
            disabled={!currentRel}
            onClick={() => setWithCtx((v) => !v)}
            title={currentRel ? "发送时附带当前笔记内容" : "未打开笔记"}
          >
            笔记上下文 {withCtx && currentRel ? "✓" : ""}
          </button>
          <button className="ai-icon-btn" onClick={() => void pickImage()} disabled={busy} title="选择图片文件，自动转笔记">
            <IconImage />
          </button>
          <button
            className="ai-icon-btn"
            onClick={() => void takeScreenshot()}
            disabled={shotBusy || busy}
            title="截图（拖选区域）并自动转笔记"
          >
            <IconCamera />
          </button>
          <div style={{ flex: 1 }} />
          {primaryMode === "url" ? (
            <button className="ai-primary-pill" disabled={busy} onClick={primaryAction}>
              <IconGlobe size={14} /> 网页转笔记
            </button>
          ) : primaryMode === "image" ? (
            <button className="ai-primary-pill" disabled={busy} onClick={primaryAction}>
              <IconImage size={14} /> 图片转笔记
            </button>
          ) : (
            <button className="ai-send" disabled={busy || (!input.trim() && !hasImages)} onClick={primaryAction} title={`发送 ${MOD}↩`}>
              <IconSend size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
