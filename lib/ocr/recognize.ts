import "server-only";
import OpenAI, { APIError } from "openai";
import { env } from "@/lib/env";
import type { SlotTime } from "@/lib/db/schema";
import { ocrJsonSchema, ocrResultSchema, type OcrResult } from "./schema";

export const buildPrompt = (groupShort: string, slotTimes: SlotTime[], imageCount: number) => {
  const variants = [groupShort, groupShort.replace(/(\D)(\d)/g, "$1-$2").replace(/(\d)(\D)/g, "$1-$2"), groupShort.replace(/-/g, "")]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((v) => `«${v}»`)
    .join(", ");
  const slots = slotTimes.length ? slotTimes.map((s) => `${s.slot}-я пара ${s.start}–${s.end}`).join("; ") : "номера пар — по порядку сверху вниз";
  const multi =
    imageCount > 1
      ? `Изображений ${imageCount} — это части одного документа в порядке загрузки (верх и низ страницы или страницы 1, 2, …). Группа обычно только на одном из них; если таблица разрезана между фото, объедини верх и низ.`
      : "Изображение одно.";
  return `Ты извлекаешь расписание из скана документа учебного отдела вуза.
На изображениях — расписание НЕСКОЛЬКИХ групп на одну неделю. Найди столбец или строки ТОЛЬКО группы ${variants} (возможны варианты написания с дефисами, пробелами, латинской «O» вместо нуля и наоборот). Все другие группы полностью игнорируй. ${multi}

Как устроен документ (обычно): строки — дни недели и номера пар со временем, столбцы — группы. Ячейка, разделённая горизонтальной чертой: верхняя половина — верхняя неделя (числитель), нижняя — нижняя (знаменатель). Ячейка, разделённая вертикальной чертой, — подгруппы: включи обе пары и напиши в raw_text, что это подгруппы. Ячейка, объединённая на несколько групп (поток), относится и к нашей группе.

Правила:
- Для каждой пары укажи день недели (mon..sat), номер пары (slot), время начала и конца, предмет, вид занятия, преподавателя и аудиторию. Преподаватель и аудитория — отдельные поля.
- Сетка звонков группы: ${slots}. Если время в ячейке не указано, поставь null — мы возьмём по номеру пары. Время пиши строго ЧЧ:ММ.
- Дробная ячейка или пометки «верх/низ», «числитель/знаменатель», «ч/з», «I/II» — пара идёт только по верхней или нижней неделе: week_type "upper" или "lower". Обычная ячейка — "both".
- Рукописная правка поверх зачёркнутого печатного текста: действует рукописная; поставь uncertain: true и приведи оба варианта в raw_text. Зачёркнуто без замены — пары нет.
- Пустая ячейка = пары нет. НИЧЕГО НЕ ВЫДУМЫВАЙ и не заполняй по аналогии.
- Не разобрал текст — заполни как смог, поставь uncertain: true и перепиши символы буквально в raw_text; сомнения опиши в confidence_notes.
- Сокращения предметов не расшифровывай, переноси как написано.
- В group_label_seen запиши название группы точно так, как оно напечатано в найденном столбце (или null).
- Если группу на изображениях найти не удалось — group_found: false и пустой список lessons.
Ответ — строго JSON по схеме.`;
};

type RecognizeInput = {
  images: { dataUrl: string }[];
  groupShort: string;
  slotTimes: SlotTime[];
  strong?: boolean;
};

export type RecognizeUsage = { prompt: number; completion: number };
export type RecognizeOutput = { result: OcrResult; model: string; attempts: number; usage: RecognizeUsage | null; durationMs: number; schemaFallback: boolean };

/** Человеческое объяснение ошибки провайдера: что делать админу, а не текст SDK на английском. */
export function describeProviderError(e: unknown, model: string): string {
  if (e instanceof APIError) {
    const status = e.status ?? 0;
    const msg = (e.message || "").slice(0, 200);
    if (status === 401 || status === 403) return "Ключ Polza не принят — проверь POLZA_API_KEY в настройках Vercel";
    if (status === 402 || /insufficient|balance|funds|недостаточно|quota/i.test(msg)) return "На балансе Polza нет денег — пополни и повтори";
    if (status === 404 || /model.*(not found|does not exist|unknown)|no such model/i.test(msg)) return `Модель ${model} не найдена в каталоге polza.ai — поправь OCR_MODEL или OCR_MODEL_STRONG`;
    if (status === 429) return "Polza отвечает «слишком много запросов» — подожди минуту и повтори";
    if (status >= 500) return `Polza временно недоступна (HTTP ${status}) — повтори через пару минут или заполни вручную`;
    return `Polza отклонила запрос (HTTP ${status}): ${msg}`;
  }
  if (e instanceof Error && /timed out|timeout|aborted/i.test(e.message)) return "Модель не ответила за отведённое время — попробуй одно фото, кадр ближе к столбцу группы или сильную модель";
  return e instanceof Error ? e.message : "Распознавание не удалось";
}

const schemaRejected = (e: unknown) => e instanceof APIError && e.status === 400 && /response_format|json_schema|schema|strict/i.test(e.message ?? "");
const transient = (e: unknown) =>
  (e instanceof APIError && (e.status === 429 || (e.status ?? 0) >= 500)) || (e instanceof Error && /timed out|timeout|ECONNRESET|fetch failed|socket hang up/i.test(e.message));

/**
 * Скан → структурированное расписание через PolzaAI (OpenAI-совместимый API).
 * Строгая JSON-схема в response_format; если шлюз её не принимает — json_object со схемой в промпте.
 * Таймауты и 5xx повторяются один раз, ответ не по схеме — один повтор с указанием ошибки. Общий бюджет 95 с.
 */
export async function recognizeSchedule(input: RecognizeInput): Promise<RecognizeOutput> {
  const model = input.strong ? env.polza.strongModel : env.polza.model;
  const started = Date.now();
  if (env.polza.mock) return { result: mockResult(input.groupShort), model: "mock", attempts: 1, usage: null, durationMs: Date.now() - started, schemaFallback: false };
  if (!env.polza.apiKey) throw new Error("POLZA_API_KEY не задан — распознавание недоступно, заполни неделю вручную");

  const deadline = started + 95_000;
  const client = new OpenAI({ apiKey: env.polza.apiKey, baseURL: env.polza.baseUrl, timeout: 60_000, maxRetries: 0 });
  const prompt = buildPrompt(input.groupShort, input.slotTimes, input.images.length);
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: prompt },
    ...input.images.map((img) => ({ type: "image_url" as const, image_url: { url: img.dataUrl, detail: "high" as const } })),
  ];

  const usage: RecognizeUsage = { prompt: 0, completion: 0 };
  let attempts = 0;
  let schemaFallback = false;
  let lastSchemaError = "";
  let retriedTransient = false;

  while (attempts < 3) {
    const remaining = deadline - Date.now();
    if (attempts > 0 && remaining < 25_000) break;
    attempts++;
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "user", content }];
    if (schemaFallback) messages.push({ role: "user", content: `Верни ТОЛЬКО JSON по этой схеме, без пояснений:\n${JSON.stringify(ocrJsonSchema)}` });
    if (lastSchemaError) messages.push({ role: "user", content: `Предыдущий ответ не прошёл проверку схемы: ${lastSchemaError}. Верни исправленный JSON строго по схеме.` });
    try {
      const res = await client.chat.completions.create(
        {
          model,
          messages,
          temperature: 0,
          response_format: schemaFallback
            ? { type: "json_object" }
            : { type: "json_schema", json_schema: { name: "schedule", strict: true, schema: ocrJsonSchema as unknown as Record<string, unknown> } },
        },
        { timeout: Math.max(10_000, Math.min(60_000, remaining)) },
      );
      usage.prompt += res.usage?.prompt_tokens ?? 0;
      usage.completion += res.usage?.completion_tokens ?? 0;
      const text = res.choices[0]?.message?.content ?? "";
      const parsed = ocrResultSchema.safeParse(extractJson(text));
      if (parsed.success) return { result: parsed.data, model, attempts, usage: usage.prompt ? usage : null, durationMs: Date.now() - started, schemaFallback };
      lastSchemaError = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || "невалидный JSON";
    } catch (e) {
      if (!schemaFallback && schemaRejected(e)) {
        // Шлюз не понимает strict json_schema — переключаемся на json_object, попытка не считается.
        schemaFallback = true;
        attempts--;
        continue;
      }
      if (transient(e) && !retriedTransient && deadline - Date.now() >= 25_000) {
        retriedTransient = true;
        continue;
      }
      throw new Error(describeProviderError(e, model));
    }
  }
  throw new Error(`Модель вернула ответ не по схеме (${lastSchemaError}). Попробуй сильную модель или внеси вручную.`);
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/** Тестовый ответ для локальной разработки без ключа Polza (OCR_MOCK=1). */
function mockResult(groupShort: string): OcrResult {
  const mk = (day: OcrResult["lessons"][number]["day"], slot: number, subject: string, type: OcrResult["lessons"][number]["lesson_type"], teacher: string, room: string, extra: Partial<OcrResult["lessons"][number]> = {}) => ({
    day,
    slot,
    time_start: null,
    time_end: null,
    subject,
    lesson_type: type,
    teacher,
    room,
    week_type: "both" as const,
    uncertain: false,
    raw_text: `${subject} ${teacher} ${room}`,
    ...extra,
  });
  return {
    group_found: true,
    group_label_seen: groupShort,
    week_type: "upper",
    confidence_notes: `Тестовый режим (OCR_MOCK=1), группа ${groupShort}. Ячейка вт/3 плохо читается.`,
    lessons: [
      mk("mon", 1, "Математический анализ", "лекция", "Иванова И.И.", "214"),
      mk("mon", 2, "Математический анализ", "практика", "Иванова И.И.", "214"),
      mk("mon", 3, "Микроэкономика", "лекция", "Петров П.П.", "305"),
      mk("tue", 2, "Английский язык", "практика", "Смирнова А.В.", "118"),
      mk("tue", 3, "История России", "лекция", "Кузнецов С.Н.", "402", { uncertain: true, raw_text: "Истор. Росс. Кузн~цов 4О2" }),
      mk("wed", 1, "Философия", "лекция", "Орлова Е.М.", "310"),
      mk("wed", 2, "Информатика", "лаба", "Соколов Д.А.", "207", { week_type: "upper" }),
      mk("wed", 2, "Правоведение", "практика", "Морозова Т.К.", "401", { week_type: "lower" }),
      mk("thu", 2, "Микроэкономика", "практика", "Петров П.П.", "305"),
      mk("thu", 3, "Правоведение", "лекция", "Морозова Т.К.", "401"),
      mk("fri", 1, "Математический анализ", "практика", "Иванова И.И.", "214"),
      mk("fri", 2, "Физическая культура", "практика", "Волков А.А.", "Спортзал"),
      mk("sat", 1, "Английский язык", "практика", "Смирнова А.В.", "118"),
    ],
  };
}
