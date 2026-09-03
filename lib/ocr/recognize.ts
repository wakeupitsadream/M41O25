import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";
import type { SlotTime } from "@/lib/db/schema";
import { ocrJsonSchema, ocrResultSchema, type OcrResult } from "./schema";

export const buildPrompt = (groupShort: string, slotTimes: SlotTime[]) => {
  const variants = [groupShort, groupShort.replace(/(\D)(\d)/g, "$1-$2").replace(/(\d)(\D)/g, "$1-$2"), groupShort.replace(/-/g, "")]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((v) => `«${v}»`)
    .join(", ");
  const slots = slotTimes.length ? slotTimes.map((s) => `${s.slot}-я пара ${s.start}–${s.end}`).join("; ") : "номера пар — по порядку сверху вниз";
  return `Ты извлекаешь расписание из скана документа учебного отдела вуза.
На изображениях — расписание НЕСКОЛЬКИХ групп на одну неделю. Найди столбец или строки ТОЛЬКО группы ${variants} (возможны варианты написания с дефисами и пробелами). Все другие группы полностью игнорируй.

Правила:
- Для каждой пары укажи день недели (mon..sat), номер пары (slot), время начала и конца, предмет, вид занятия, преподавателя и аудиторию. Преподаватель и аудитория — отдельные поля.
- Сетка звонков группы: ${slots}. Если время в ячейке не указано, поставь null — мы возьмём по номеру пары.
- Дробная ячейка или пометки «верх/низ», «числитель/знаменатель», «ч/з», «I/II» — пара идёт только по верхней или нижней неделе: week_type "upper" или "lower". Обычная ячейка — "both".
- Ячейка, объединённая на несколько групп (поток), относится и к нашей группе.
- Пустая ячейка = пары нет. НИЧЕГО НЕ ВЫДУМЫВАЙ и не заполняй по аналогии.
- Не разобрал текст — заполни как смог, поставь uncertain: true и перепиши символы буквально в raw_text; сомнения опиши в confidence_notes.
- Сокращения предметов не расшифровывай, переноси как написано.
- Если группу на изображениях найти не удалось — group_found: false и пустой список lessons.
Ответ — строго JSON по схеме.`;
};

type RecognizeInput = {
  images: { dataUrl: string }[];
  groupShort: string;
  slotTimes: SlotTime[];
  strong?: boolean;
};

export type RecognizeOutput = { result: OcrResult; model: string; attempts: number };

/**
 * Скан → структурированное расписание через PolzaAI (OpenAI-совместимый API).
 * JSON-схема в response_format + Zod-валидация с одним повтором: агрегаторы не всегда строгие.
 */
export async function recognizeSchedule(input: RecognizeInput): Promise<RecognizeOutput> {
  const model = input.strong ? env.polza.strongModel : env.polza.model;
  if (env.polza.mock) return { result: mockResult(input.groupShort), model: "mock", attempts: 1 };
  if (!env.polza.apiKey) throw new Error("POLZA_API_KEY не задан — распознавание недоступно, заполни неделю вручную");

  // Общий бюджет 95 с (maxDuration роута 120 с): первая попытка до 60 с, вторая — только если осталось ≥ 25 с.
  const deadline = Date.now() + 95_000;
  const client = new OpenAI({ apiKey: env.polza.apiKey, baseURL: env.polza.baseUrl, timeout: 60_000, maxRetries: 0 });
  const prompt = buildPrompt(input.groupShort, input.slotTimes);
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: prompt },
    ...input.images.map((img) => ({ type: "image_url" as const, image_url: { url: img.dataUrl, detail: "high" as const } })),
  ];

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = deadline - Date.now();
    if (attempt === 2 && remaining < 25_000) break;
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "user", content }];
    if (lastError) messages.push({ role: "user", content: `Предыдущий ответ не прошёл проверку схемы: ${lastError}. Верни исправленный JSON строго по схеме.` });
    const res = await client.chat.completions.create(
      {
        model,
        messages,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "schedule", strict: true, schema: ocrJsonSchema as unknown as Record<string, unknown> } },
      },
      { timeout: Math.max(10_000, Math.min(60_000, remaining)) },
    );
    const text = res.choices[0]?.message?.content ?? "";
    const json = extractJson(text);
    const parsed = ocrResultSchema.safeParse(json);
    if (parsed.success) return { result: parsed.data, model, attempts: attempt };
    lastError = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || "невалидный JSON";
  }
  throw new Error(`Модель дважды вернула ответ не по схеме (${lastError}). Попробуй сильную модель или внеси вручную.`);
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
