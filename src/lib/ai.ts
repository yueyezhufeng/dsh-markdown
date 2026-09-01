import type { Config } from "./types";

/**
 * 流式 AI 对话（跨平台）。
 *
 * Electron 版：主进程通过 `ai:chat` IPC 发起 SSE 请求，
 * 增量经 `window.electronAPI.aiChunkSubscribe(requestId, cb)` 推送。
 *
 * 接口与 Tauri 版完全一致（返回完整正文，onDelta 实时回调）。
 */
export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}

export interface AiChunk {
  delta: string;
  reasoning: boolean;
  done: boolean;
  error?: string;
}

let lastRequestId = 0;

function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

/**
 * 流式对话。
 * onDelta(delta, full) - 正文增量回调
 * onReasoningDelta(reasoningFull) - 思维链增量回调（可选）
 * 返回完整正文文本。
 */
export async function aiChat(
  cfg: Config,
  messages: AiMessage[],
  onDelta: (delta: string, full: string) => void,
  maxTokens?: number,
  onReasoningDelta?: (reasoningFull: string) => void,
): Promise<string> {
  lastRequestId++;
  const requestId = `${Date.now()}-${lastRequestId}`;
  let full = "";
  let reasoningFull = "";
  let settled = false;

  return new Promise<string>((resolve, reject) => {
    const finish = (ok: boolean, err?: string) => {
      if (settled) return;
      settled = true;
      if (ok) resolve(full);
      else reject(new Error(err || "AI 请求失败"));
    };

    if (isElectron()) {
      const api = (window as any).electronAPI;
      const unsub = api.aiChunkSubscribe(requestId, (chunk: AiChunk) => {
        if (chunk.error) return finish(false, chunk.error);
        if (chunk.delta && !chunk.reasoning) {
          full += chunk.delta;
          onDelta(chunk.delta, full);
        }
        if (chunk.delta && chunk.reasoning) {
          reasoningFull += chunk.delta;
          onReasoningDelta?.(reasoningFull);
        }
        if (chunk.done) finish(true);
      });
      // 发送请求（主进程启动 SSE 流，事件回推）
      api.aiChat({
        requestId,
        baseUrl: cfg.aiBaseUrl,
        apiKey: cfg.aiApiKey,
        model: cfg.aiModel,
        messages,
        maxTokens: maxTokens ?? null,
      }).catch((err: unknown) => {
        finish(false, String(err));
      });
      // 超时保护
      const timer = setTimeout(() => {
        unsub();
        finish(false, "AI 请求超时（5 分钟）");
      }, 300000);
      // done 时清理计时器（在 finish 中统一处理）
      const _origFinish = finish;
      (finish as unknown as { _timer?: ReturnType<typeof setTimeout> })._timer = timer;
      return;
    }

    // Tauri 版：invoke + listen
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      let un: (() => void) | null = null;
      un = await listen<AiChunk>(`ai-chunk-${requestId}`, (e) => {
        const chunk = e.payload;
        if (chunk.error) return finish(false, chunk.error);
        if (chunk.delta && !chunk.reasoning) {
          full += chunk.delta;
          onDelta(chunk.delta, full);
        }
        if (chunk.delta && chunk.reasoning) {
          reasoningFull += chunk.delta;
          onReasoningDelta?.(reasoningFull);
        }
        if (chunk.done) {
          un?.();
          finish(true);
        }
      });
      void import("@tauri-apps/api/core").then((m) =>
        m
          .invoke<void>("ai_chat", {
            requestId,
            baseUrl: cfg.aiBaseUrl,
            apiKey: cfg.aiApiKey,
            model: cfg.aiModel,
            messages,
            maxTokens: maxTokens ?? null,
          })
          .catch((err) => finish(false, String(err))),
      );
    });
  });
}