import { useState } from "react";
import { useStore } from "../lib/store";
import type { Config } from "../lib/types";

/** 设置：知识库路径 / DeepSeek API / 主题 */
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.config);
  const selectVault = useStore((s) => s.selectVault);
  const setStore = useStore((s) => s.set);
  const [vaultPath, setVaultPath] = useState(config?.vaultPath ?? "");
  const [baseUrl, setBaseUrl] = useState(config?.aiBaseUrl ?? "https://api.deepseek.com");
  const [model, setModel] = useState(config?.aiModel ?? "deepseek-v4-flash");
  const [visionModel, setVisionModel] = useState(config?.aiVisionModel ?? "deepseek-v4-flash-vision-exp");
  const [apiKey, setApiKey] = useState(config?.aiApiKey ?? "");
  const [theme, setTheme] = useState<Config["theme"]>(config?.theme ?? "auto");
  const [saving, setSaving] = useState(false);
  const [changedVault, setChangedVault] = useState(false);

  const pickDir = async () => {
    try {
      let dir: string | null = null;
      if (typeof window !== "undefined" && (window as any).electronAPI) {
        dir = await (window as any).electronAPI.pickDirectory();
      } else {
        const { open } = await import("@tauri-apps/plugin-dialog");
        dir = await open({ directory: true, title: "选择知识库目录" });
      }
      if (typeof dir === "string") {
        setVaultPath(dir);
        setChangedVault(dir !== config?.vaultPath);
      }
    } catch (e) {
      alert(`打开目录选择框失败：${e}`);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      if (changedVault && vaultPath) {
        await selectVault(vaultPath);
      }
      const { api } = await import("../lib/api");
      const cfg: Config = await api.setConfig({
        aiBaseUrl: baseUrl,
        aiModel: model,
        aiVisionModel: visionModel,
        aiApiKey: apiKey,
        theme,
      });
      setStore({ config: cfg });
      document.documentElement.dataset.theme = resolveTheme(cfg.theme);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="quickopen-mask" onMouseDown={onClose}>
      <div
        className="quickopen"
        style={{ width: 480, padding: 0 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "18px 20px 0", fontSize: 15, fontWeight: 600 }}>设置</div>
        <div style={{ padding: "12px 20px 18px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "70vh", overflowY: "auto" }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>知识库目录（笔记、附件统一存放）</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" value={vaultPath} onChange={(e) => { setVaultPath(e.target.value); setChangedVault(true); }} placeholder="~/Documents/dsh-notes" style={{ flex: 1, minWidth: 0, userSelect: "text" }} />
              <button className="btn" onClick={() => void pickDir()} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>选择</button>
            </div>
          </div>

          <div style={{ height: 1, background: "var(--border)" }} />

          <div style={{ fontSize: 13, fontWeight: 600 }}>DeepSeek AI</div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>API 地址（OpenAI 兼容）</div>
            <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={{ userSelect: "text" }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>模型</div>
            <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-flash" style={{ userSelect: "text" }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>视觉模型（图片理解 / 图片转笔记）</div>
            <input className="input" value={visionModel} onChange={(e) => setVisionModel(e.target.value)} placeholder="deepseek-v4-flash-vision-exp" style={{ userSelect: "text" }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>API Key</div>
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" style={{ userSelect: "text" }} />
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>仅保存在本机（~/Library/Application Support/dsh-markdown/config.json）</div>
          </div>

          <div style={{ height: 1, background: "var(--border)" }} />

          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>外观</div>
            <select className="input" value={theme} onChange={(e) => setTheme(e.target.value as Config["theme"])}>
              <option value="auto">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={onClose}>取消</button>
            <button className="btn primary" disabled={saving} onClick={() => void save()}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function resolveTheme(theme: string): "light" | "dark" {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
