import { createHash } from "node:crypto";
import type { Config, ProviderId, Task } from "../config.js";
import type { ModelState, Store } from "../db/store.js";
import { errorText, log } from "../log.js";
import { formatWhen, localDayIso, nextPacificMidnight, nextUtcMidnight } from "../util/time.js";
import { CATALOG, DEFAULT_CHAINS, modelFromKey } from "./catalog.js";
import { LlmError, classifyThrown, type ErrorKind } from "./errors.js";
import { GEMINI_AUDIO, callGemini } from "./gemini.js";
import { callOpenAI, providerBase } from "./openai.js";
import { transcribeWith } from "./transcribe.js";
import { hasAudio, type GenerateRequest, type GenerateResult, type LlmMessage, type ModelInfo } from "./types.js";

/** Запас времени после ответа модели: разметка и отправка в MAX. */
const RESERVE_MS = 12_000;
const MIN_ATTEMPT_MS = 6_000;

export type Attempt = { model: ModelInfo; kind: ErrorKind; message: string; until: Date | null };
export type Skip = { model: ModelInfo; why: "no_key" | "cooldown" | "capability"; until?: Date | null; reason?: string | null };

export class AllModelsFailed extends Error {
  constructor(
    readonly task: Task,
    readonly attempts: Attempt[],
    readonly skipped: Skip[],
    readonly outOfTime: boolean,
  ) {
    super(`все модели цепочки ${task} недоступны`);
    this.name = "AllModelsFailed";
  }
}

export type RouterDeps = {
  config: Config;
  store: Pick<Store, "modelStates" | "recordModel">;
  fetch?: typeof fetch;
  now?: () => Date;
};

export type ChainStatus = Array<{ model: ModelInfo; state: "ok" | "no_key" | "cooldown"; until: Date | null; reason: string | null; ok: number; fail: number }>;

const fingerprint = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 8);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Когда модель снова стоит пробовать после ошибки; null — пауза не нужна (дело в самом запросе). */
export function cooldownUntil(model: ModelInfo, e: LlmError, now: Date, fullTimeout: boolean): Date | null {
  const at = (ms: number) => new Date(now.getTime() + ms);
  const retry = e.opts.retryAfterMs;
  switch (e.kind) {
    case "quota_day": {
      if (retry && retry > 0 && retry <= 26 * 3_600_000) return at(retry);
      return model.provider === "gemini" ? nextPacificMidnight(now) : nextUtcMidnight(now);
    }
    case "rate_limit":
      return at(clamp(retry ?? 60_000, 5_000, 15 * 60_000));
    case "auth":
      return at(30 * 60_000);
    case "region":
      return at(12 * 3_600_000);
    case "not_found":
      return at(6 * 3_600_000);
    case "overloaded":
      return at(clamp(retry ?? 45_000, 15_000, 5 * 60_000));
    case "timeout":
      return fullTimeout ? at(2 * 60_000) : null;
    case "network":
      return at(30_000);
    default:
      return null;
  }
}

export function createRouter(deps: RouterDeps) {
  const { config, store } = deps;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  const keyFor = (p: ProviderId) => config.keys[p] ?? "";

  function chain(task: Task): ModelInfo[] {
    const keys = config.chains[task] ?? DEFAULT_CHAINS[task];
    const out: ModelInfo[] = [];
    for (const k of keys) {
      const m = CATALOG[k] ?? modelFromKey(k);
      if (m && !out.some((x) => x.key === m.key)) out.push(m);
    }
    return out;
  }

  /** Пауза ещё действует? Пауза из-за ключа снимается сразу, если ключ в env поменяли. */
  function activeCooldown(model: ModelInfo, state: ModelState | undefined, at: Date): ModelState | null {
    if (!state?.cooldownUntil || state.cooldownUntil.getTime() <= at.getTime()) return null;
    if (state.reason?.startsWith("auth:") && state.reason !== `auth:${fingerprint(keyFor(model.provider))}`) return null;
    return state;
  }

  function fits(model: ModelInfo, messages: LlmMessage[]): boolean {
    const images = messages.flatMap((m) => m.parts.filter((p) => p.type === "image"));
    if (images.length > 0) {
      if (!model.vision || images.length > model.maxImages) return false;
      if (images.some((p) => p.type === "image" && (p.data.length > model.maxImageBytes || !model.imageMimes.includes(p.mime)))) {
        return false;
      }
    }
    if (hasAudio(messages)) {
      if (!model.audio) return false;
      const audio = messages.flatMap((m) => m.parts).filter((p) => p.type === "audio");
      if (audio.some((p) => p.type === "audio" && !GEMINI_AUDIO.has(p.mime))) return false;
    }
    return true;
  }

  async function record(model: ModelInfo, e: LlmError | null, fullTimeout: boolean): Promise<Date | null> {
    const day = localDayIso(now(), config.tz);
    try {
      if (!e) {
        await store.recordModel(model.key, day, { ok: true });
        return null;
      }
      const until = cooldownUntil(model, e, now(), fullTimeout);
      const reason = e.kind === "auth" ? `auth:${fingerprint(keyFor(model.provider))}` : e.kind;
      await store.recordModel(model.key, day, { ok: false, cooldownUntil: until, reason, error: e.message });
      return until;
    } catch (err) {
      log("error", "model_state_write_failed", { model: model.key, error: errorText(err) });
      return null;
    }
  }

  async function call(model: ModelInfo, req: GenerateRequest, signal: AbortSignal) {
    if (model.provider === "gemini") return callGemini(model, req, keyFor("gemini"), { fetch: fetchFn, signal });
    const base = providerBase(model.provider, config.cloudflareAccountId);
    if (!base) throw new LlmError("auth", `провайдер ${model.provider} не настроен`);
    return callOpenAI(model, req, { base, key: keyFor(model.provider) }, { fetch: fetchFn, signal });
  }

  async function generate(task: Task, req: GenerateRequest, opts: { deadline: number }): Promise<GenerateResult> {
    const states = await store.modelStates().catch((err) => {
      log("error", "model_state_read_failed", { error: errorText(err) });
      return new Map<string, ModelState>();
    });
    const attempts: Attempt[] = [];
    const skipped: Skip[] = [];
    let outOfTime = false;
    for (const model of chain(task)) {
      if (!keyFor(model.provider)) {
        skipped.push({ model, why: "no_key" });
        continue;
      }
      if (!fits(model, req.messages)) {
        skipped.push({ model, why: "capability" });
        continue;
      }
      const cd = activeCooldown(model, states.get(model.key), now());
      if (cd) {
        skipped.push({ model, why: "cooldown", until: cd.cooldownUntil, reason: cd.reason });
        continue;
      }
      const remaining = opts.deadline - Date.now() - RESERVE_MS;
      if (remaining < MIN_ATTEMPT_MS) {
        outOfTime = true;
        break;
      }
      const timeout = Math.min(model.timeoutMs, remaining);
      const started = Date.now();
      try {
        const r = await call(model, req, AbortSignal.timeout(timeout));
        await record(model, null, false);
        log("info", "llm_ok", { task, model: model.key, ms: Date.now() - started, finish: r.finishReason, usage: r.usage });
        return { ...r, model, ms: Date.now() - started };
      } catch (err) {
        const e = classifyThrown(err);
        const until = await record(model, e, timeout >= model.timeoutMs);
        attempts.push({ model, kind: e.kind, message: e.message, until });
        log("warn", "llm_fail", { task, model: model.key, kind: e.kind, status: e.opts.status, ms: Date.now() - started, error: e.message });
      }
    }
    throw new AllModelsFailed(task, attempts, skipped, outOfTime);
  }

  async function transcribe(audio: { data: Buffer; mime: string }, opts: { deadline: number }): Promise<{ text: string; model: ModelInfo }> {
    const states = await store.modelStates().catch(() => new Map<string, ModelState>());
    const attempts: Attempt[] = [];
    const skipped: Skip[] = [];
    let outOfTime = false;
    for (const model of chain("transcribe")) {
      if (!keyFor(model.provider)) {
        skipped.push({ model, why: "no_key" });
        continue;
      }
      if (model.provider === "gemini" && !GEMINI_AUDIO.has(audio.mime)) {
        skipped.push({ model, why: "capability" });
        continue;
      }
      const cd = activeCooldown(model, states.get(model.key), now());
      if (cd) {
        skipped.push({ model, why: "cooldown", until: cd.cooldownUntil, reason: cd.reason });
        continue;
      }
      const remaining = opts.deadline - Date.now() - RESERVE_MS;
      if (remaining < MIN_ATTEMPT_MS) {
        outOfTime = true;
        break;
      }
      const timeout = Math.min(model.timeoutMs, remaining);
      try {
        const text = await transcribeWith(model, audio, {
          key: keyFor(model.provider),
          cloudflareAccountId: config.cloudflareAccountId,
          fetch: fetchFn,
          signal: AbortSignal.timeout(timeout),
          gemini: (m, req, signal) => callGemini(m, req, keyFor("gemini"), { fetch: fetchFn, signal }),
        });
        await record(model, null, false);
        return { text, model };
      } catch (err) {
        const e = classifyThrown(err);
        const until = await record(model, e, timeout >= model.timeoutMs);
        attempts.push({ model, kind: e.kind, message: e.message, until });
        log("warn", "transcribe_fail", { model: model.key, kind: e.kind, error: e.message });
      }
    }
    throw new AllModelsFailed("transcribe", attempts, skipped, outOfTime);
  }

  async function status(task: Task): Promise<ChainStatus> {
    const states = await store.modelStates();
    const t = now();
    return chain(task).map((model) => {
      const st = states.get(model.key);
      const today = st?.day === localDayIso(t, config.tz);
      const cd = keyFor(model.provider) ? activeCooldown(model, st, t) : null;
      return {
        model,
        state: !keyFor(model.provider) ? "no_key" : cd ? "cooldown" : "ok",
        until: cd?.cooldownUntil ?? null,
        reason: cd?.reason ?? null,
        ok: today ? (st?.okCount ?? 0) : 0,
        fail: today ? (st?.failCount ?? 0) : 0,
      };
    });
  }

  return { generate, transcribe, status, chain };
}

export type Router = ReturnType<typeof createRouter>;

const KIND_TEXT: Record<string, string> = {
  quota_day: "дневной лимит",
  rate_limit: "лимит в минуту",
  auth: "ключ не принят",
  region: "регион сервера не поддерживается",
  not_found: "модель недоступна",
  overloaded: "перегружена",
  timeout: "не ответила вовремя",
  network: "сетевая ошибка",
  bad_request: "не приняла запрос",
  too_large: "запрос слишком большой",
  safety: "ответ заблокирован фильтром",
  empty: "пустой ответ",
};

export const kindText = (kind: string | null | undefined) => KIND_TEXT[(kind ?? "").split(":")[0]!] ?? "недоступна";

/** Человеческое объяснение, почему ответа нет: что с какой моделью и когда она вернётся. */
export function describeFailure(err: AllModelsFailed, now: Date, tz: string): string {
  const lines: string[] = [];
  for (const a of err.attempts) {
    lines.push(`• ${a.model.label}: ${kindText(a.kind)}${a.until && a.kind !== "timeout" ? ` (до ${formatWhen(a.until, now, tz)})` : ""}`);
  }
  for (const s of err.skipped) {
    if (s.why === "cooldown") lines.push(`• ${s.model.label}: ${kindText(s.reason)}${s.until ? ` (до ${formatWhen(s.until, now, tz)})` : ""}`);
  }
  const noKey = err.skipped.filter((s) => s.why === "no_key").map((s) => s.model.provider);
  const uniqueNoKey = [...new Set(noKey)];
  if (uniqueNoKey.length) lines.push(`• без ключа: ${uniqueNoKey.join(", ")}`);
  if (err.outOfTime) lines.push("• не хватило времени на запасные модели");
  if (!lines.length) lines.push("• в цепочке нет моделей, подходящих под этот запрос");
  return lines.join("\n");
}
