import { z } from "zod";
import type { AssistantSettings, AssistantSettingsStored } from "./types";

/**
 * Умолчания из docs/AI-CHAT.md §1: выключен, 200 ₽/мес, 15 в день, 45 в неделю, 3 сильных, неделя триала.
 * Неделя 45 и 3 сильных — не круглые числа ради красоты: при 200 ₽ и 50/4 худший случай давал маржу 57 %, ниже
 * требования владельца (≥ 60 %), а 45/3 дают 63 % с запасом. Инвариант закреплён тестом в estimate.test.ts.
 */
export const DEFAULT_SETTINGS: AssistantSettings = {
  enabled: false,
  priceRub: 200,
  dailyLimit: 15,
  weeklyLimit: 45,
  strongWeeklyLimit: 3,
  trialDays: 7,
  paymentNote: "",
};

export const PRICE_MAX_RUB = 5000;
export const LIMIT_MIN = 1;
export const LIMIT_MAX = 200;
export const TRIAL_MAX_DAYS = 30;
export const PAYMENT_NOTE_MAX = 500;

/** Одно сообщение на все проверки поля: админу важно, какое поле не так, а не какая именно граница нарушена. */
const int = (message: string, min: number, max: number) => z.number({ error: message }).int(message).min(min, message).max(max, message);

export const assistantSettingsSchema = z.object({
  enabled: z.boolean(),
  priceRub: int(`Цена — целое число от 0 до ${PRICE_MAX_RUB} ₽`, 0, PRICE_MAX_RUB),
  dailyLimit: int(`Лимит в день — от ${LIMIT_MIN} до ${LIMIT_MAX} сообщений`, LIMIT_MIN, LIMIT_MAX),
  weeklyLimit: int(`Лимит в неделю — от ${LIMIT_MIN} до ${LIMIT_MAX} сообщений`, LIMIT_MIN, LIMIT_MAX),
  strongWeeklyLimit: int(`Сильных в неделю — от ${LIMIT_MIN} до ${LIMIT_MAX}`, LIMIT_MIN, LIMIT_MAX),
  trialDays: int(`Дней триала — от 0 до ${TRIAL_MAX_DAYS}`, 0, TRIAL_MAX_DAYS),
  paymentNote: z.string({ error: "Реквизиты — текст" }).trim().max(PAYMENT_NOTE_MAX, `Реквизиты — не длиннее ${PAYMENT_NOTE_MAX} символов`),
});

type Key = keyof AssistantSettings;
const KEYS = Object.keys(DEFAULT_SETTINGS) as Key[];

/**
 * Настройки из jsonb → полный объект. Проверяется каждое поле отдельно: испорченное значение (правка базы руками,
 * старый формат) откатывается к своему умолчанию, а не роняет всю группу на дефолты и тем более не роняет страницу.
 */
export function withDefaults(stored: AssistantSettingsStored | null | undefined): AssistantSettings {
  const out: AssistantSettings = { ...DEFAULT_SETTINGS };
  if (!stored || typeof stored !== "object") return out;
  for (const key of KEYS) {
    const parsed = assistantSettingsSchema.shape[key].safeParse(stored[key]);
    if (parsed.success) (out as Record<Key, unknown>)[key] = parsed.data;
  }
  return out;
}

export type ParsedSettingsForm = { ok: true; settings: AssistantSettings } | { ok: false; error: string };

/** Число из поля формы: пустая строка и мусор → NaN, чтобы схема дала своё сообщение, а не «0». */
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(",", ".");
  return s === "" ? Number.NaN : Number(s);
};

/** Тумблер в форме — скрытый input (SwitchRow сам ничего не отправляет); нет поля или «false»/«0» — выключен. */
const flag = (v: FormDataEntryValue | null) => ["on", "true", "1"].includes(String(v ?? "").trim().toLowerCase());

/**
 * Разбор админской формы «Помощник по учёбе». Имена полей — как ключи AssistantSettings:
 * enabled, priceRub, dailyLimit, weeklyLimit, strongWeeklyLimit, trialDays, paymentNote.
 */
export function parseSettingsForm(fd: FormData): ParsedSettingsForm {
  const parsed = assistantSettingsSchema.safeParse({
    enabled: flag(fd.get("enabled")),
    priceRub: num(fd.get("priceRub")),
    dailyLimit: num(fd.get("dailyLimit")),
    weeklyLimit: num(fd.get("weeklyLimit")),
    strongWeeklyLimit: num(fd.get("strongWeeklyLimit")),
    trialDays: num(fd.get("trialDays")),
    paymentNote: String(fd.get("paymentNote") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверь поля" };
  const s = parsed.data;
  // Недельный лимит меньше дневного — не ошибка формы, а бессмыслица: сообщим прямо, а не будем молча резать день.
  if (s.weeklyLimit < s.dailyLimit) return { ok: false, error: "Лимит в неделю не может быть меньше лимита в день" };
  if (s.strongWeeklyLimit > s.weeklyLimit) return { ok: false, error: "Сильных в неделю не может быть больше, чем сообщений в неделю" };
  return { ok: true, settings: s };
}
