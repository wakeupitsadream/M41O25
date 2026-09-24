"use client";

import { useState } from "react";
import { updateAssistantSettings } from "@/app/admin/actions/assistant";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SwitchRow } from "@/components/ui/switch";
import { SubmitButton } from "@/components/admin/forms";
import { worstCaseEstimate, type EstimateModels, type WorstCaseEstimate } from "@/lib/assistant/estimate";
import { MARGIN_OK_PCT } from "@/lib/assistant/finance";
import { PAYMENT_NOTE_MAX } from "@/lib/assistant/settings";
import type { AssistantSettings } from "@/lib/assistant/types";
import { cn, pluralRu } from "@/lib/utils";

type NumKey = "priceRub" | "dailyLimit" | "weeklyLimit" | "strongWeeklyLimit" | "trialDays";

const TONE_TEXT = { ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;

/** Как parseSettingsForm читает число: запятая как точка, пусто и мусор — не число (оценку тогда не показываем). */
const toNum = (s: string) => {
  const t = s.trim().replace(",", ".");
  const n = t === "" ? Number.NaN : Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Неразрывный пробел перед «₽» и «%»: на узком экране сумма не должна рваться на «0,30» и «₽» по разным строкам. */
const NB = " ";

const rub = (kopecks: number) => (kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Карточка «Помощник по учёбе» в настройках (docs/AI-CHAT.md §9). Клиентская, потому что тумблер — кнопка, а не
 * поле формы (его значение уезжает скрытым input «enabled»), и потому что оценка себестоимости пересчитывается
 * на лету, пока админ подбирает цену и лимиты, — до сохранения. Курс, наценку и модели передаёт сервер из env.
 */
export function AssistantSettingsForm({
  values,
  configured,
  models,
  rate,
  markup,
}: {
  values: AssistantSettings;
  /** Есть ключ Polza (или OCR_MOCK=1): без него включить нельзя — действие всё равно откажет. */
  configured: boolean;
  models: EstimateModels;
  rate: number;
  markup: number;
}) {
  const [enabled, setEnabled] = useState(values.enabled);
  const [nums, setNums] = useState<Record<NumKey, string>>({
    priceRub: String(values.priceRub),
    dailyLimit: String(values.dailyLimit),
    weeklyLimit: String(values.weeklyLimit),
    strongWeeklyLimit: String(values.strongWeeklyLimit),
    trialDays: String(values.trialDays),
  });

  const num = (key: NumKey, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        name={key}
        inputMode="numeric"
        autoComplete="off"
        value={nums[key]}
        onChange={(e) => setNums((prev) => ({ ...prev, [key]: e.target.value }))}
        className="px-3 tnum"
        required
      />
    </Field>
  );

  const price = toNum(nums.priceRub);
  const daily = toNum(nums.dailyLimit);
  const weekly = toNum(nums.weeklyLimit);
  const strong = toNum(nums.strongWeeklyLimit);
  const input = price !== null && daily !== null && weekly !== null && strong !== null ? { price, daily, weekly, strong } : null;
  const estimate = input
    ? worstCaseEstimate({ priceRub: input.price, dailyLimit: input.daily, weeklyLimit: input.weekly, strongWeeklyLimit: input.strong }, models, rate, markup)
    : null;

  return (
    <ActionForm action={updateAssistantSettings} className="space-y-3">
      <div className="font-display text-[16px] font-bold">Помощник по учёбе</div>
      <p className="text-[13px] text-muted">ИИ-чат во вкладке «Группа»: пробная неделя, потом доступ по оплате — продлеваешь в карточке человека.</p>
      {/*
        Выключить можно и без ключа (ключ убрали, а помощник остался включён — иначе его было бы не погасить),
        включить — нет: студент увидел бы плитку, а ответить помощник не смог бы.
      */}
      <SwitchRow
        checked={enabled}
        onChange={setEnabled}
        disabled={!configured && !enabled}
        label="Включён"
        hint={configured ? "Студенты увидят плитку «Помощник» в разделе «Группа»." : "Нет ключа Polza — задай POLZA_API_KEY в Vercel, тогда можно включить."}
        className="bg-surface-2"
      />
      <input type="hidden" name="enabled" value={enabled ? "on" : "off"} />
      <div className="grid grid-cols-2 gap-2">
        {num("priceRub", "Цена, ₽/мес", "За «+30 дней»")}
        {num("trialDays", "Дней триала", "0 — без пробной")}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {num("dailyLimit", "В день")}
        {num("weeklyLimit", "В неделю")}
        {num("strongWeeklyLimit", "Сильных/нед")}
      </div>
      <Field label="Реквизиты для перевода" hint="Покажем студентам в «Как оплатить»: номер по СБП, банк, имя.">
        <Textarea name="paymentNote" defaultValue={values.paymentNote} maxLength={PAYMENT_NOTE_MAX} placeholder="СБП +7 900 000-00-00, Т-Банк, Иван И." rows={3} />
      </Field>
      <EstimateLine estimate={estimate} input={input} models={models} rate={rate} markup={markup} />
      <SubmitButton className="w-full" variant="secondary">
        Сохранить
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * Справка «худший случай»: один человек выбирает все лимиты каждую неделю. Не прогноз выручки группы — ориентир,
 * хватает ли цены на самого активного (цель владельца — маржа ≥ 60 % до налога, §1).
 */
function EstimateLine({
  estimate,
  input,
  models,
  rate,
  markup,
}: {
  estimate: WorstCaseEstimate | null;
  input: { price: number; daily: number; weekly: number; strong: number } | null;
  models: EstimateModels;
  rate: number;
  markup: number;
}) {
  if (!estimate || !input) return <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-dim">Оценка себестоимости появится, когда цена и лимиты — числа.</p>;
  const short = (m: string) => m.split("/").at(-1) ?? m;
  const markupPct = Math.round((markup - 1) * 100);
  const basis =
    `Худший случай — человек выбирает все лимиты: ${estimate.messages} ${pluralRu(estimate.messages, "сообщение", "сообщения", "сообщений")}, ` +
    `из них ${estimate.strongMessages} ${pluralRu(estimate.strongMessages, "сильное", "сильных", "сильных")}. ` +
    `Ответ ≈${NB}${rub(estimate.perMessage.normal)}${NB}₽ (${short(models.model)}), сильный ≈${NB}${rub(estimate.perMessage.strong)}${NB}₽ (${short(models.strongModel)}); ` +
    `курс ${rate}${NB}₽/$, наценка Polza ${markupPct}${NB}%.`;
  return (
    <div className="space-y-1 rounded-md bg-surface-2 px-3 py-2 text-[13px] leading-snug text-muted">
      <p>
        При цене {input.price}
        {NB}₽ и лимитах {input.daily}/день · {input.weekly}/нед, сильных {input.strong}/нед себестоимость в худшем случае ≈{NB}
        <span className="font-semibold text-fg tnum">
          {rub(estimate.costKopecks)}
          {NB}₽
        </span>{" "}
        за 30 дней
        {estimate.marginPct === null ? (
          <>
            {NB}— <span className={cn("font-semibold", TONE_TEXT[estimate.tone])}>помощник бесплатный</span>, весь расход на тебе.
          </>
        ) : (
          <>
            , маржа ≈{NB}
            <span className={cn("font-semibold tnum", TONE_TEXT[estimate.tone])}>
              {estimate.marginPct}
              {NB}%
            </span>
            {estimate.marginPct < MARGIN_OK_PCT ? `${NB}— ниже цели ${MARGIN_OK_PCT}${NB}%.` : "."}
          </>
        )}
      </p>
      <p className="text-[12px] text-dim">{basis}</p>
    </div>
  );
}
