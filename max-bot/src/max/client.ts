import { errorText } from "../log.js";
import type {
  BotCommand,
  BotInfo,
  Message,
  NewMessageBody,
  SenderAction,
  Subscription,
  UpdateType,
} from "./types.js";

export class MaxApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly description: string,
  ) {
    super(`MAX ${status} ${code}: ${description}`);
    this.name = "MaxApiError";
  }
}

export type Target = { chatId: number } | { userId: number };

export type Downloaded = { data: Buffer; contentType: string | null };

export type MaxClient = {
  getMe(): Promise<BotInfo>;
  getSubscriptions(): Promise<Subscription[]>;
  subscribe(url: string, secret: string, updateTypes: UpdateType[]): Promise<void>;
  unsubscribe(url: string): Promise<void>;
  sendMessage(target: Target, body: NewMessageBody): Promise<Message>;
  editMessage(mid: string, body: NewMessageBody): Promise<void>;
  deleteMessage(mid: string): Promise<void>;
  answerCallback(callbackId: string, body: { notification?: string; message?: NewMessageBody }): Promise<void>;
  sendAction(chatId: number, action: SenderAction): Promise<void>;
  setCommands(commands: BotCommand[]): Promise<void>;
  download(url: string, maxBytes: number): Promise<Downloaded>;
};

type Options = {
  token: string;
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

type Query = Record<string, string | number | boolean | null | undefined>;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Ошибка до отправки запроса: адрес не разрешился или соединение не открылось. */
function notConnected(err: unknown): boolean {
  const code = (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code ?? "";
  return ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "ENETUNREACH", "EHOSTUNREACH"].includes(code);
}

/** Хосты MAX, которым можно показать токен, если файл не отдаётся без авторизации. */
const MAX_HOSTS = /(^|\.)(max\.ru|oneme\.ru)$/i;

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const sec = Number(raw);
  if (Number.isFinite(sec)) return Math.min(Math.max(sec, 0) * 1000, 10_000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 10_000) : null;
}

export function createMaxClient(opts: Options): MaxClient {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const sleep = opts.sleep ?? defaultSleep;
  const base = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;

  async function call<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    {
      query = {},
      body,
      retries = 2,
      idempotent = true,
      timeout = timeoutMs,
    }: { query?: Query; body?: unknown; retries?: number; idempotent?: boolean; timeout?: number } = {},
  ): Promise<T> {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Authorization: opts.token };
    if (body !== undefined) headers["content-type"] = "application/json";

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchFn(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        });
      } catch (err) {
        // Неидемпотентный запрос (отправка сообщения) повторяем, только если соединение даже не установилось:
        // иначе MAX мог сообщение принять, и повтор продублировал бы ответ.
        if (attempt < retries && (idempotent || notConnected(err))) {
          await sleep(800 * 2 ** attempt);
          continue;
        }
        throw new MaxApiError(0, "network", errorText(err));
      }
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      const obj = (data && typeof data === "object" ? data : {}) as { code?: string; message?: string; success?: boolean };
      if (res.status === 200) {
        if (obj.success === false) throw new MaxApiError(200, "action.failed", obj.message ?? "success: false");
        return data as T;
      }
      if (attempt < retries && (res.status === 429 || res.status === 503 || (idempotent && res.status >= 500))) {
        await sleep(retryAfterMs(res) ?? 800 * 2 ** attempt);
        continue;
      }
      throw new MaxApiError(res.status, obj.code ?? "http", obj.message ?? text.slice(0, 300));
    }
  }

  async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new MaxApiError(413, "file.too.big", `${declared} bytes`);
    if (!res.body) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new MaxApiError(413, "file.too.big", `> ${maxBytes} bytes`);
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  return {
    getMe: () => call<BotInfo>("GET", "me"),
    getSubscriptions: async () =>
      (await call<{ subscriptions?: Subscription[] }>("GET", "subscriptions")).subscriptions ?? [],
    subscribe: async (url, secret, updateTypes) => {
      await call("POST", "subscriptions", { body: { url, secret, update_types: updateTypes } });
    },
    unsubscribe: async (url) => {
      await call("DELETE", "subscriptions", { query: { url } });
    },
    sendMessage: async (target, body) => {
      const query: Query = "chatId" in target ? { chat_id: target.chatId } : { user_id: target.userId };
      const res = await call<{ message: Message }>("POST", "messages", { query, body, idempotent: false, timeout: 30_000 });
      return res.message;
    },
    editMessage: async (mid, body) => {
      await call("PUT", "messages", { query: { message_id: mid }, body });
    },
    deleteMessage: async (mid) => {
      await call("DELETE", "messages", { query: { message_id: mid }, retries: 0 });
    },
    answerCallback: async (callbackId, body) => {
      await call("POST", "answers", { query: { callback_id: callbackId }, body, retries: 1 });
    },
    sendAction: async (chatId, action) => {
      await call("POST", `chats/${chatId}/actions`, { body: { action }, retries: 0 });
    },
    setCommands: async (commands) => {
      await call("PATCH", "me/commands", { body: { commands } });
    },
    download: async (url, maxBytes) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new MaxApiError(400, "bad.url", parsed.protocol);
      let res = await fetchFn(parsed, { signal: AbortSignal.timeout(30_000) });
      if ((res.status === 401 || res.status === 403) && MAX_HOSTS.test(parsed.hostname)) {
        await res.body?.cancel();
        res = await fetchFn(parsed, { headers: { Authorization: opts.token }, signal: AbortSignal.timeout(30_000) });
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new MaxApiError(res.status, "download.failed", parsed.hostname);
      }
      return { data: await readLimited(res, maxBytes), contentType: res.headers.get("content-type") };
    },
  };
}
