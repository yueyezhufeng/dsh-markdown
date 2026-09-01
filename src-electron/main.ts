import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import fsNode from "node:fs";
import https from "node:https";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { URL } from "node:url";

const isDev = !app.isPackaged;
const VITE_DEV_URL = "http://localhost:1430";
const DIST_DIR = path.join(__dirname, "../dist");
const PRELOAD = path.join(__dirname, "preload.js");

let vaultPath: string | null = null;
let appConfig = loadConfig();

function configPath() { return path.join(app.getPath("userData"), "config.json"); }

function loadConfig() {
  try {
    const raw = JSON.parse(fsNode.readFileSync(configPath(), "utf-8"));
    return {
      vaultPath: raw.vaultPath || null,
      aiBaseUrl: raw.aiBaseUrl || "https://api.deepseek.com",
      aiModel: raw.aiModel || "deepseek-v4-flash",
      aiVisionModel: raw.aiVisionModel || "deepseek-v4-flash-vision-exp",
      aiApiKey: raw.aiApiKey || "",
      theme: raw.theme || "auto",
    };
  } catch {
    return { vaultPath: null, aiBaseUrl: "https://api.deepseek.com", aiModel: "deepseek-v4-flash", aiVisionModel: "deepseek-v4-flash-vision-exp", aiApiKey: "", theme: "auto" };
  }
}

function saveConfig(cfg: any) {
  fsNode.mkdirSync(path.dirname(configPath()), { recursive: true });
  fsNode.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf-8");
}

function createWindow(): BrowserWindow {
  const dark = appConfig.theme === "dark";
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 960, minHeight: 600,
    backgroundColor: dark ? "#23262b" : "#f7f8fa",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: dark ? "#23262b" : "#f7f8fa",
      symbolColor: dark ? "#9aa0a8" : "#333",
      height: 38,
    },
    trafficLightPosition: { x: 12, y: 10 },
    show: false,
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // 兜底：即便 ready-to-show 因故未触发（如渲染卡顿），也保证窗口显示
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 2000);
  win.webContents.setMaxListeners(32);
  if (isDev) {
    win.loadURL(VITE_DEV_URL);
    win.webContents.on("before-input-event", (_e, input) => {
      if (input.type === "keyDown" && input.key === "F12") win.webContents.toggleDevTools();
    });
  } else {
    win.loadFile(path.join(DIST_DIR, "index.html"));
  }
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("did-finish-load", () => tryFlushOpenRequests());
  return win;
}

// ─── FS handlers ────────────────────────────────────────────────────────────
function registerFsHandlers(win: BrowserWindow) {
  const HIDDEN = new Set([".dsh", ".git", ".obsidian", ".DS_Store"]);
  function resolve(rel: string): string {
    if (!vaultPath) throw new Error("未设置知识库目录");
    rel = rel.replace(/^[/\\]+/, "");
    const joined = path.join(vaultPath, rel);
    const norm = joined.replace(/\\/g, "/");
    const base = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "");
    // 边界校验：必须等于 vault 本身或以 "vault/" 开头，防止 ../ 逃逸与前缀碰撞（如 Vault vs Vault2）
    if (norm !== base && !norm.startsWith(base + "/")) throw new Error("非法路径");
    return norm;
  }
  function toRel(abs: string): string {
    return path.relative(vaultPath!, abs).replace(/\\/g, "/");
  }
  function sanitize(n: string) {
    // Windows 非法字符：\ / : * ? " < > |；macOS/Linux 仅禁 /（目录分隔符）与 NUL
    const re = process.platform === "win32" ? /[\/\\:*?"<>|]/g : /[/\u0000]/g;
    return n.replace(re, " ").replace(/\s+/g, " ").trim();
  }
  function collectFiles(root: string, depth = 0): string[] {
    if (depth > 12) return [];
    let entries: fsNode.Dirent[];
    try { entries = fsNode.readdirSync(root, { withFileTypes: true }); } catch { return []; }
    const out: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".") || HIDDEN.has(e.name)) continue;
      const full = path.join(root, e.name);
      if (e.isDirectory()) out.push(...collectFiles(full, depth + 1));
      else { const ext = path.extname(e.name).slice(1).toLowerCase(); if (ext === "md" || ext === "markdown" || ext === "txt") out.push(full); }
    }
    return out;
  }
  function noteTitle(abs: string): string | null {
    try {
      if (fsNode.statSync(abs).size > 512 * 1024) return null;
      const text = fsNode.readFileSync(abs, "utf-8");
      let inFm = false, fmStarted = false;
      for (const [i, line] of text.split("\n").entries()) {
        if (i === 0 && line.trim() === "---") { inFm = true; fmStarted = true; continue; }
        if (fmStarted && inFm) {
          if (line.trim() === "---") { inFm = false; continue; }
          const m = line.trim().match(/^title:\s*(.+)/);
          if (m) return m[1].trim().replace(/^["']|["']$/g, "");
          continue;
        }
        if (!inFm) { if (line.startsWith("# ")) { const t = line.slice(2).trim(); if (t) return t; } if (line.trim()) return null; }
      }
    } catch { /* ignore */ }
    return null;
  }
  function extractWl(text: string): { source: string; target: string }[] {
    const out: { source: string; target: string }[] = [];
    const re = /(?<!\!)\[\[([^\[\]]+?)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { const t = m[1].split("|")[0].trim(); if (t) out.push({ source: "", target: t }); }
    return out;
  }

  win.webContents.on("ipc-message", (evt, ch, rel: string) => {
    if (ch !== "fs:list_dir") return;
    try {
      const dir = resolve(rel);
      const entries = fsNode.readdirSync(dir, { withFileTypes: true });
      const nodes = entries.filter((e) => !e.name.startsWith(".")).map((e) => {
        const isDir = e.isDirectory();
        const stat = isDir ? null : (() => { try { return fsNode.statSync(path.join(dir, e.name)); } catch { return null; } })();
        const sz = isDir ? 0 : (stat?.size ?? 0);
        const rp = rel ? `${rel.replace(/\/$/, "")}/${e.name}` : e.name;
        return { name: e.name, relPath: rp, isDir, size: sz, title: isDir ? null : noteTitle(path.join(dir, e.name)) };
      });
      nodes.sort((a, b) => { if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
      evt.reply("fs:list_dir-reply", nodes);
    } catch (e) { evt.reply("fs:list_dir-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", (evt, ch, rel: string) => {
    if (ch !== "fs:read_file") return;
    try {
      const abs = resolve(rel); const stat = fsNode.statSync(abs);
      evt.reply("fs:read_file-reply", { content: fsNode.readFileSync(abs, "utf-8"), size: stat.size, modified: Math.floor(stat.mtimeMs / 1000) });
    } catch (e) { evt.reply("fs:read_file-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", async (evt, ch, rel: string, content: string) => {
    if (ch !== "fs:write_file") return;
    try {
      const abs = resolve(rel);
      await fsNode.promises.mkdir(path.dirname(abs), { recursive: true });
      const tmp = abs + ".tmp";
      await fsNode.promises.writeFile(tmp, content, "utf-8");
      await fsNode.promises.rename(tmp, abs);
      evt.reply("fs:write_file-reply", { ok: true });
    } catch (e) { evt.reply("fs:write_file-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", (evt, ch, dir: string, title: string, content?: string | null) => {
    if (ch !== "fs:create_note") return;
    try {
      const safe = sanitize(title);
      if (!safe) throw new Error("标题不能为空");
      const baseDir = dir ? resolve(dir) : vaultPath!;
      let rel = dir ? `${dir.replace(/\/$/, "")}/${safe}.md` : `${safe}.md`;
      let n = 2;
      while (fsNode.existsSync(resolve(rel))) { rel = dir ? `${dir.replace(/\/$/, "")}/${safe}-${n}.md` : `${safe}-${n}.md`; n++; }
      const body = content ?? `# ${title}\n\n`;
      const abs = resolve(rel);
      fsNode.mkdirSync(path.dirname(abs), { recursive: true });
      fsNode.writeFileSync(abs, body, "utf-8");
      evt.reply("fs:create_note-reply", rel);
    } catch (e) { evt.reply("fs:create_note-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", (evt, ch, parent: string, name: string) => {
    if (ch !== "fs:create_dir") return;
    try {
      const safe = sanitize(name);
      if (!safe) throw new Error("名称不能为空");
      const rel = parent ? `${parent.replace(/\/$/, "")}/${safe}` : safe;
      fsNode.mkdirSync(resolve(rel), { recursive: true });
      evt.reply("fs:create_dir-reply", rel);
    } catch (e) { evt.reply("fs:create_dir-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", (evt, ch, rel: string, newName: string) => {
    if (ch !== "fs:rename_entry") return;
    try {
      const src = resolve(rel); const safe = sanitize(newName);
      if (!safe) throw new Error("名称不能为空");
      const dst = path.join(path.dirname(src), safe);
      if (fsNode.existsSync(dst)) throw new Error("同名文件已存在");
      fsNode.renameSync(src, dst);
      evt.reply("fs:rename_entry-reply", toRel(dst));
    } catch (e) { evt.reply("fs:rename_entry-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", (evt, ch, rel: string, dstDir: string) => {
    if (ch !== "fs:move_entry") return;
    try {
      const src = resolve(rel); const name = path.basename(src);
      const dst = resolve(`${dstDir}/${name}`);
      if (fsNode.existsSync(dst)) throw new Error("目标已存在同名文件");
      fsNode.renameSync(src, dst);
      evt.reply("fs:move_entry-reply", toRel(dst));
    } catch (e) { evt.reply("fs:move_entry-reply", { error: String(e) }); }
  });

  // 跨平台移入回收站（不依赖 trash 包：其随包分发的平台二进制在打包/asar 下无法正确定位）
  function trashPath(abs: string): void {
    if (process.platform === "darwin") {
      // Finder 删除 → 移入废纸篓，自动处理同名冲突与跨卷移动；无需额外二进制
      const script = `tell application "Finder" to delete POSIX file ${JSON.stringify(abs)}`;
      execFileSync("osascript", ["-e", script], { timeout: 30000 });
    } else if (process.platform === "win32") {
      // PowerShell + Microsoft.VisualBasic：文件/目录均支持 SendToRecycleBin
      const psEsc = abs.replace(/'/g, "''");
      const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; $p = '${psEsc}'; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }`;
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 60000, windowsHide: true });
    } else {
      // Linux：gio trash（无 gio 时由调用方回退 unlink）
      execFileSync("gio", ["trash", abs], { timeout: 30000 });
    }
  }

  win.webContents.on("ipc-message", async (evt, ch, rel: string) => {
    if (ch !== "fs:delete_entry") return;
    try {
      trashPath(resolve(rel));
      evt.reply("fs:delete_entry-reply", { ok: true });
    } catch {
      try { fsNode.unlinkSync(resolve(rel)); evt.reply("fs:delete_entry-reply", { ok: true }); }
      catch (e) { evt.reply("fs:delete_entry-reply", { error: String(e) }); }
    }
  });

  win.webContents.on("ipc-message", (evt, ch, query: string) => {
    if (ch !== "fs:search_vault") return;
    try {
      const q = query.toLowerCase();
      if (!q) { evt.reply("fs:search_vault-reply", []); return; }
      const files = collectFiles(vaultPath!);
      const hits: any[] = [];
      for (const abs of files) {
        if (hits.length >= 300) break;
        let text: string;
        try { text = fsNode.readFileSync(abs, "utf-8"); } catch { continue; }
        const rel = toRel(abs); const flines = text.split("\n");
        let cnt = 0;
        for (let i = 0; i < flines.length && cnt < 20; i++) {
          const line = flines[i];
          if (line.length > 500) continue;
          if (line.toLowerCase().includes(q)) {
            hits.push({ relPath: rel, lineNo: i + 1, lineText: line.trim().slice(0, 160) });
            cnt++;
          }
        }
      }
      evt.reply("fs:search_vault-reply", hits);
    } catch (e) { evt.reply("fs:search_vault-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", (evt, ch) => {
    if (ch !== "fs:list_all_notes") return;
    try {
      const files = collectFiles(vaultPath!);
      const notes = files.filter((abs) => { const e = path.extname(abs).slice(1).toLowerCase(); return e === "md" || e === "markdown"; }).map((abs) => ({ relPath: toRel(abs), title: noteTitle(abs) }));
      evt.reply("fs:list_all_notes-reply", notes);
    } catch (e) { evt.reply("fs:list_all_notes-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", (evt, ch) => {
    if (ch !== "fs:index_links") return;
    try {
      const files = collectFiles(vaultPath!);
      const links: any[] = [];
      for (const abs of files) {
        let text: string;
        try { text = fsNode.readFileSync(abs, "utf-8"); } catch { continue; }
        const rel = toRel(abs);
        for (const { target } of extractWl(text)) links.push({ source: rel, target });
      }
      evt.reply("fs:index_links-reply", links);
    } catch (e) { evt.reply("fs:index_links-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", (evt, ch, filename: string, base64Data: string) => {
    if (ch !== "fs:save_attachment") return;
    try {
      const now = new Date();
      const dir = `attachments/${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,"0")}`;
      const stamp = now.toISOString().replace(/[:T]/g, "-").slice(0, 19).replace(".", "-");
      const safe = sanitize(filename);
      const dotIdx = safe.lastIndexOf(".");
      const stem = dotIdx > 0 ? safe.slice(0, dotIdx) : safe;
      const ext = dotIdx > 0 ? safe.slice(dotIdx + 1) : "bin";
      const rel = `${dir}/${stamp}-${stem}.${ext}`;
      const abs = path.join(vaultPath!, ...rel.split("/"));
      fsNode.mkdirSync(path.dirname(abs), { recursive: true });
      fsNode.writeFileSync(abs, Buffer.from(base64Data, "base64"));
      evt.reply("fs:save_attachment-reply", rel);
    } catch (e) { evt.reply("fs:save_attachment-reply", { error: String(e) }); }
  });

  win.webContents.on("ipc-message", (evt, ch, filePath: string) => {
    if (ch !== "fs:ensure_vault") return;
    try {
      if (!fsNode.existsSync(filePath) || !fsNode.statSync(filePath).isDirectory()) throw new Error("目录不存在");
      for (const d of ["attachments", "templates", ".dsh"]) fsNode.mkdirSync(path.join(filePath, d), { recursive: true });
      const welcome = path.join(filePath, "欢迎使用.md");
      if (!fsNode.existsSync(welcome)) {
        const sample = fsNode.readdirSync(filePath, { withFileTypes: true });
        if (sample.length === 0 || sample.every((e) => e.name.startsWith("."))) {
          fsNode.writeFileSync(welcome, "# 欢迎使用 DSH Markdown\n\n开始你的知识库之旅：\n\n- 双向链接：输入 [[ 引用另一篇笔记\n- 思维导图：工具栏切换「导图」视图\n- 流程图：\n\n```mermaid\nflowchart LR\n  A[想法] --> B[记录] --> C[知识库]\n```\n\n- 粘贴图片会自动归档到 attachments/年/月\n");
        }
      }
      evt.reply("fs:ensure_vault-reply", { ok: true });
    } catch (e) { evt.reply("fs:ensure_vault-reply", { error: String(e) }); }
  });
}

// ─── Chat handlers ──────────────────────────────────────────────────────────
function registerChatHandlers(win: BrowserWindow) {
  const CHATS_SUBDIR = ".dsh/ai/chats";
  function chatsDir() {
    const d = path.join(vaultPath!, CHATS_SUBDIR);
    fsNode.mkdirSync(d, { recursive: true });
    return d;
  }
  win.webContents.on("ipc-message", (evt, ch, ...args: any[]) => {
    if (ch === "chats:list") {
      try {
        const dir = chatsDir();
        let entries: fsNode.Dirent[];
        try { entries = fsNode.readdirSync(dir, { withFileTypes: true }); } catch { evt.reply("chats:list-reply", []); return; }
        const out: any[] = [];
        for (const e of entries) {
          if (!e.name.endsWith(".json")) continue;
          try {
            const doc = JSON.parse(fsNode.readFileSync(path.join(dir, e.name), "utf-8"));
            out.push({ id: doc.id, title: doc.title, modified: doc.modified });
          } catch { /* skip */ }
        }
        out.sort((a, b) => b.modified - a.modified);
        out.splice(100);
        evt.reply("chats:list-reply", out);
      } catch (e) { evt.reply("chats:list-reply", { error: String(e) }); }
    }
    if (ch === "chats:load") {
      const id = args[0] as string;
      try {
        const safeId = id.replace(/[/\\\.]/g, "");
        const doc = JSON.parse(fsNode.readFileSync(path.join(chatsDir(), `${safeId}.json`), "utf-8"));
        evt.reply("chats:load-reply", doc);
      } catch { evt.reply("chats:load-reply", { error: "会话不存在" }); }
    }
    if (ch === "chats:save") {
      const doc = args[0];
      try {
        const safeId = doc.id.replace(/[/\\\.]/g, "");
        fsNode.writeFileSync(path.join(chatsDir(), `${safeId}.json`), JSON.stringify(doc, null, 2), "utf-8");
        evt.reply("chats:save-reply", { ok: true });
      } catch (e) { evt.reply("chats:save-reply", { error: String(e) }); }
    }
    if (ch === "chats:delete") {
      const id = args[0] as string;
      try {
        const safeId = id.replace(/[/\\\.]/g, "");
        const p = path.join(chatsDir(), `${safeId}.json`);
        if (fsNode.existsSync(p)) fsNode.unlinkSync(p);
        evt.reply("chats:delete-reply", { ok: true });
      } catch (e) { evt.reply("chats:delete-reply", { error: String(e) }); }
    }
  });
}

// ─── Fetch handlers ────────────────────────────────────────────────────────
function registerFetchHandlers(win: BrowserWindow) {
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
  function fetchText(url: string, timeoutMs = 20000): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === "https:" ? https : http;
      const req = mod.get(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location, timeoutMs).then(resolve).catch(reject); return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const ct = (res.headers["content-type"] ?? "") as string;
        if (!ct.includes("html") && !ct.includes("text")) { res.resume(); return reject(new Error(`不支持的内容类型：${ct}`)); }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      });
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("请求超时")); });
    });
  }
  function extractText(html: string): [string, string] {
    let title = "";
    const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (tm) title = tm[1].trim();
    let body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<noscript[\s\S]*?<\/noscript>/gi, "").replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
    const bs = body.indexOf("<body");
    if (bs !== -1) { const gt = body.indexOf(">", bs); body = body.slice(gt + 1); const be = body.indexOf("</body>"); if (be !== -1) body = body.slice(0, be); }
    for (const tag of ["h1","h2","h3","h4","h5","h6","p","li","br","div","tr"]) body = body.replace(new RegExp(`</?${tag}[^>]*>`, "gi"), "\n");
    body = body.replace(/<\/?(td|th)[^>]*>/gi, " | ").replace(/<[^>]+>/g, "");
    body = body.replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/g,"'");
    body = body.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0).join("\n");
    if (body.length > 60 * 1024) body = body.slice(0, 60 * 1024);
    if (!title) title = body.split("\n")[0]?.slice(0, 80) || "";
    return [title, body];
  }
  function extractImages(html: string): string[] {
    const out: string[] = [];
    const imgRe = /<img[^>]+>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(html)) && out.length < 20) {
      const tag = m[0]; let url = "";
      for (const attr of ["data-src", "data-original", "src"]) {
        const re = new RegExp(`${attr}\\s*=\\s*["\x27]([^"\x27]+)["\x27]`, "i");
        const am = tag.match(re);
        if (am) { url = am[1]; break; }
      }
      if (!url) continue;
      url = url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      if (url.startsWith("data:") || url.length < 20 || !url.startsWith("http")) continue;
      if (url.includes("emoji") || url.includes("icon") || url.includes("/0?")) continue;
      const fm = url.match(/wx_fmt=([^&]+)/);
      if (fm && (fm[1] === "svg" || fm[1] === "other")) continue;
      if (!out.includes(url)) out.push(url);
    }
    return out;
  }
  function downloadBuf(url: string, timeoutMs = 20000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === "https:" ? https : http;
      mod.get(url, { headers: { "User-Agent": UA } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { downloadBuf(res.headers.location, timeoutMs).then(resolve).catch(reject); return; }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }).on("error", reject);
      setTimeout(() => reject(new Error("下载超时")), timeoutMs);
    });
  }
  win.webContents.on("ipc-message", (evt, ch, url: string) => {
    if (ch !== "fetch:page") return;
    fetchText(url).then((html) => {
      const [title, text] = extractText(html);
      evt.reply("fetch:page-reply", { url, title, text, images: extractImages(html) });
    }).catch((e) => evt.reply("fetch:page-reply", { error: String(e) }));
  });
  win.webContents.on("ipc-message", (evt, ch, urls: string[], vp: string) => {
    if (ch !== "fetch:download_images") return;
    const now = new Date();
    const dir = `attachments/${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,"0")}`;
    const stamp = now.toISOString().replace(/[:T]/g, "-").slice(0, 19).replace(".", "-");
    const result: string[] = [];
    let pending = 0;
    const done = () => { if (--pending === 0) evt.reply("fetch:download_images-reply", result); };
    for (let i = 0; i < Math.min(urls.length, 20); i++) {
      pending++;
      downloadBuf(urls[i]).then((buf) => {
        if (buf.length < 5 * 1024) { done(); return; }
        const rel = `${dir}/clip-${stamp}-${i}.jpg`;
        const abs = path.join(vp, ...rel.split("/"));
        fsNode.mkdirSync(path.dirname(abs), { recursive: true });
        fsNode.writeFileSync(abs, buf);
        result.push(rel); done();
      }).catch(() => { done(); });
    }
    if (pending === 0) evt.reply("fetch:download_images-reply", result);
  });
}

// ─── Watcher handlers ───────────────────────────────────────────────────────
let watcherInst: any = null;
let lastEventTime = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function registerWatcherHandlers(win: BrowserWindow) {
  win.webContents.on("ipc-message", (evt, ch, vp?: string) => {
    if (ch === "watcher:start") {
      if (watcherInst) { watcherInst.close(); watcherInst = null; }
      const target = vp || appConfig.vaultPath;
      if (!target) { evt.reply("watcher:start-reply", { error: "未设置知识库目录" }); return; }
      const chokidar = require("chokidar");
      watcherInst = chokidar.watch(target, {
        ignored: (p: string) => { const parts = p.split(/[\\/]/).filter(Boolean); return parts.some((part: string) => (part.startsWith(".") && part !== "." && part !== "..") || part === "node_modules" || part === ".git" || part === ".obsidian" || part === ".dsh"); },
        persistent: true, ignoreInitial: true, depth: 20,
      });
      watcherInst.on("all", () => {
        const now = Date.now();
        if (now - lastEventTime < 400) return;
        lastEventTime = now;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { win.webContents.send("fs-change"); }, 50);
      });
      evt.reply("watcher:start-reply", { ok: true });
    }
    if (ch === "watcher:stop") { if (watcherInst) { watcherInst.close(); watcherInst = null; } evt.reply("watcher:stop-reply", { ok: true }); }
  });
}
// --- Screenshot handler ---
function registerScreenshotHandlers(win: BrowserWindow) {
  win.webContents.on("ipc-message", (evt, ch) => {
    if (ch !== "screenshot:interactive") return;
    try {
      const os = require("node:os");
      const tmpPath = require("node:path").join(os.tmpdir(), `dsh-shot-${Date.now()}.png`);
      const plat = os.platform();
      if (plat === "darwin") {
        require("node:child_process").execFileSync("screencapture", ["-i", "-x", tmpPath], { timeout: 60000 });
      } else if (plat === "linux") {
        try { require("node:child_process").execFileSync("gnome-screenshot", ["-i", "-f", tmpPath], { timeout: 60000 }); }
        catch { try { require("node:child_process").execFileSync("import", ["-window", "root", tmpPath], { timeout: 60000 }); }
        catch { evt.reply("screenshot:interactive-reply", { error: "未找到截图工具，请安装 gnome-screenshot 或 imagemagick" }); return; } }
      } else {
        // Windows: PowerShell 截取主屏幕
        try {
          const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $gfx = [System.Drawing.Graphics]::FromImage($bmp); $gfx.CopyFromScreen([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Location, [System.Drawing.Point]::Empty, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Size); $bmp.Save($tmpPath, [System.Drawing.Imaging.ImageFormat]::Png); $gfx.Dispose(); $bmp.Dispose()`;
          require("node:child_process").execFileSync("powershell", ["-Command", ps], { timeout: 30000, windowsHide: true });
        } catch { evt.reply("screenshot:interactive-reply", { error: "截图失败" }); return; }
      }
      const fs2 = require("node:fs");
      if (!fs2.existsSync(tmpPath)) { evt.reply("screenshot:interactive-reply", null); return; }
      const bytes = fs2.readFileSync(tmpPath);
      try { fs2.unlinkSync(tmpPath); } catch {}
      evt.reply("screenshot:interactive-reply", bytes.toString("base64"));
    } catch (e) { evt.reply("screenshot:interactive-reply", { error: String(e) }); }
  });
}

// --- AI chat SSE streaming ---
function registerAiHandlers(win: BrowserWindow) {
  win.webContents.on("ipc-message", (evt, ch, params) => {
    if (ch !== "ai:chat") return;
    if (!params) return;
    const requestId = params.requestId;
    const eventName = `ai-chunk:${requestId}`;
    const send = (chunk: any) => win.webContents.send(eventName, chunk);
    const emit = (delta: string, reasoning: boolean, done: boolean, error?: string) => send({ delta, reasoning, done, error });
    if (!params.apiKey) { emit("", false, true, "未配置 API Key，请先在设置中填写"); return; }
    const baseUrl = (params.baseUrl || "https://api.deepseek.com").replace(/\/$/, "");
    const url = `${baseUrl}/chat/completions`;
    const body = JSON.stringify({ model: params.model, messages: params.messages, stream: true, max_tokens: params.maxTokens ?? undefined });
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${params.apiKey}`,
      },
    }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        let msg = "";
        res.on("data", (d: Buffer) => { msg += d.toString(); });
        res.on("end", () => emit("", false, true, `HTTP ${res.statusCode}：${msg.slice(0, 200)}`));
        return;
      }
      let buf = "";
      res.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf-8");
        while (buf.includes("\n")) {
          const idx = buf.indexOf("\n");
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") { emit("", false, true); return; }
          try {
            const v = JSON.parse(data);
            const reasoning = v?.choices?.[0]?.delta?.reasoning_content ?? "";
            if (reasoning) emit(String(reasoning), true, false);
            const delta = v?.choices?.[0]?.delta?.content ?? "";
            if (delta) emit(String(delta), false, false);
          } catch { /* ignore parse error */ }
        }
      });
      res.on("end", () => { emit("", false, true); });
    });
    req.on("error", (e: any) => emit("", false, true, `网络错误：${e.message || e}`));
    req.setTimeout(300000, () => { req.destroy(); emit("", false, true, "请求超时（5 分钟）"); });
    req.write(body);
    req.end();
  });
}
// --- Config handlers + app bootstrap ---
let mainWindow: BrowserWindow | null = null;

// ─── 系统"打开文件"请求（Windows 双击 .md / macOS open-file）─────────────
let rendererOpenReady = false;
const pendingOpen: string[] = [];

// 从命令行参数里找出真实文件：跳过 -xx 选项与开发模式参数，只认存在的 .md/.markdown/.txt 文件
function extractFileArg(argv: string[]): string | null {
  for (const raw of argv) {
    if (!raw || raw.startsWith("-")) continue;
    let p: string;
    try { p = path.resolve(raw); } catch { continue; }
    try {
      if (!fsNode.statSync(p).isFile()) continue;
      const ext = path.extname(p).slice(1).toLowerCase();
      if (ext !== "md" && ext !== "markdown" && ext !== "txt") continue;
      return p;
    } catch { /* 非文件参数 */ }
  }
  return null;
}

function queueOpenFile(absPath: string | null) {
  if (!absPath) return;
  if (!pendingOpen.includes(absPath)) pendingOpen.push(absPath);
  tryFlushOpenRequests();
}

// 仅当渲染进程已订阅（发送过 open-file:ready）且窗口加载完成时才推送，避免事件丢失
function tryFlushOpenRequests() {
  if (!rendererOpenReady || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  while (pendingOpen.length) mainWindow.webContents.send("open-file:request", pendingOpen.shift());
}

// macOS：Finder 双击 / 拖到 Dock 图标触发，可能在 ready 前到达 → 必须在顶层注册
app.on("open-file", (e, p) => { e.preventDefault(); queueOpenFile(path.resolve(p)); });

// 同步 vault 路径到各 handler
function setVault(p: string | null) {
  vaultPath = p;
  if (mainWindow) (mainWindow.webContents as any)._vaultPath = p;
}

ipcMain.handle("config:get", () => appConfig);

// 渲染进程告知实际明暗主题，动态更新窗口控制按钮颜色（Windows WCO / macOS 红绿灯）
ipcMain.on("window:set_theme", (_e, theme: string) => {
  if (!mainWindow) return;
  const isDark = theme === "dark";
  mainWindow.setTitleBarOverlay({
    color: isDark ? "#23262b" : "#f7f8fa",
    symbolColor: isDark ? "#9aa0a8" : "#333",
    height: 38,
  });
});

ipcMain.handle("config:set", (_e, patch: any) => {
  if (patch?.vaultPath !== undefined) { appConfig.vaultPath = patch.vaultPath || null; setVault(appConfig.vaultPath); }
  if (patch?.aiBaseUrl !== undefined) appConfig.aiBaseUrl = patch.aiBaseUrl;
  if (patch?.aiModel !== undefined) appConfig.aiModel = patch.aiModel;
  if (patch?.aiVisionModel !== undefined) appConfig.aiVisionModel = patch.aiVisionModel;
  if (patch?.aiApiKey !== undefined) appConfig.aiApiKey = patch.aiApiKey;
  if (patch?.theme !== undefined) appConfig.theme = patch.theme;
  saveConfig(appConfig);
  // vault 变更时重启文件监听
  if (patch?.vaultPath !== undefined) {
    const chokidar = require("chokidar");
    if (watcherInst) { watcherInst.close(); watcherInst = null; }
    if (appConfig.vaultPath) {
      watcherInst = chokidar.watch(appConfig.vaultPath, {
        ignored: (p: string) => { const parts = p.split(/[\\/]/).filter(Boolean); return parts.some((part: string) => (part.startsWith(".") && part !== "." && part !== "..") || part === "node_modules" || part === ".git" || part === ".obsidian" || part === ".dsh"); },
        persistent: true, ignoreInitial: true, depth: 20,
      });
      watcherInst.on("all", () => {
        const now = Date.now();
        if (now - lastEventTime < 400) return;
        lastEventTime = now;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { if (mainWindow) mainWindow.webContents.send("fs-change"); }, 50);
      });
    }
  }
  if (mainWindow) {
    // 通知渲染进程配置已更新
    mainWindow.webContents.send("config-changed", appConfig);
  }
  return appConfig;
});

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, commandLine: string[]) => {
    // 应用已在运行时再次双击 .md：从第二实例命令行里取出文件并转发
    const f = extractFileArg(commandLine);
    if (f) queueOpenFile(f);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    appConfig = loadConfig();
    setVault(appConfig.vaultPath);
    mainWindow = createWindow();

    // 启动参数可能携带被双击的文件（Windows/Linux 应用未运行时在资源管理器双击）
    const launchFile = extractFileArg(process.argv);
    if (launchFile) queueOpenFile(launchFile);

    // 渲染进程就绪：它先订阅 open-file:request，再发送此消息，之后主进程推送才不丢事件
    ipcMain.on("open-file:ready", () => { rendererOpenReady = true; tryFlushOpenRequests(); });
    // 启动早期窗口未就绪时的兜底：渲染进程主动拉取待打开列表
    ipcMain.handle("fs:get_pending_opens", () => pendingOpen.splice(0));

    // 注册各 handler
    registerFsHandlers(mainWindow);
    registerChatHandlers(mainWindow);
    registerFetchHandlers(mainWindow);
    registerScreenshotHandlers(mainWindow);
    registerWatcherHandlers(mainWindow);
    registerAiHandlers(mainWindow);

    // 启动时若已有 vault，自动开始监听
    if (appConfig.vaultPath) {
      const chokidar = require("chokidar");
      if (watcherInst) watcherInst.close();
      watcherInst = chokidar.watch(appConfig.vaultPath, {
        ignored: (p: string) => { const parts = p.split(/[\\/]/).filter(Boolean); return parts.some((part: string) => (part.startsWith(".") && part !== "." && part !== "..") || part === "node_modules" || part === ".git" || part === ".obsidian" || part === ".dsh"); },
        persistent: true, ignoreInitial: true, depth: 20,
      });
      watcherInst.on("all", () => {
        const now = Date.now();
        if (now - lastEventTime < 400) return;
        lastEventTime = now;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { if (mainWindow) mainWindow.webContents.send("fs-change"); }, 50);
      });
    }

    mainWindow.on("closed", () => { mainWindow = null; });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        setVault(appConfig.vaultPath);
        registerFsHandlers(mainWindow);
        registerChatHandlers(mainWindow);
        registerFetchHandlers(mainWindow);
        registerScreenshotHandlers(mainWindow);
        registerWatcherHandlers(mainWindow);
        registerAiHandlers(mainWindow);
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
// --- Image picker (dialog) ---
ipcMain.handle("dialog:pick_images", async () => {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择图片",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  if (result.canceled || !result.filePaths.length) return [];
  const out = [];
  for (const f of result.filePaths.slice(0, 4)) {
    try {
      const buf = fsNode.readFileSync(f);
      const ext = require("node:path").extname(f).slice(1).toLowerCase() || "png";
      out.push(`data:image/${ext};base64,${buf.toString("base64")}`);
    } catch { /* skip */ }
  }
  return out;
});

// --- Directory picker (settings: vault selection) ---
ipcMain.handle("dialog:pick_directory", async () => {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择知识库目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ─── 外部文档（系统唤起打开：不在 vault 内，可编辑并写回原绝对路径）────────
const EXTERNAL_DOC_EXTS = new Set(["md", "markdown", "txt"]);
function assertExternalDoc(absPath: string): string {
  const p = path.resolve(String(absPath || ""));
  const ext = path.extname(p).slice(1).toLowerCase();
  if (!EXTERNAL_DOC_EXTS.has(ext)) throw new Error("不支持的文件类型");
  return p;
}

ipcMain.handle("fs:read_external", (_e, absPath: string) => {
  const p = assertExternalDoc(absPath);
  const st = fsNode.statSync(p);
  if (!st.isFile()) throw new Error("不是文件");
  const buf = fsNode.readFileSync(p);
  return { content: buf.toString("utf-8"), size: st.size, modified: Math.floor(st.mtimeMs / 1000) };
});

ipcMain.handle("fs:write_external", async (_e, absPath: string, content: string) => {
  const p = assertExternalDoc(absPath);
  const st = fsNode.statSync(p);
  if (!st.isFile()) throw new Error("不是文件");
  // 原子写入：先写 .tmp 再重命名，与 vault 内文件保存方式一致
  const tmp = p + ".tmp";
  await fsNode.promises.writeFile(tmp, content, "utf-8");
  await fsNode.promises.rename(tmp, p);
  return { ok: true };
});
