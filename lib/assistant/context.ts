import type { Role, SlotTime } from "@/lib/db/schema";
import type { SemesterPhase } from "@/lib/schedule/derive";
import { KIND_LABEL, PARITY_LABEL, type ScheduleHomework, type ScheduleLesson } from "@/lib/schedule/types";
import { estimateTokens } from "./pricing";
import { clipText, ddmm, weekdayRu } from "./compact";
import type { ChatMessage } from "./types";

/*
 * Компактный контекст запроса и отбор истории (docs/AI-CHAT.md §6). Чистый модуль: данные собирает
 * loadContextInput (lib/assistant/tools-data.ts), здесь только текст — так его размер меряется в тестах.
 * Цель — 800–1500 токенов: то, о чём спрашивают чаще всего (сегодня, завтра, ближайшая домашка), модель видит
 * сразу, остальное добирает инструментами.
 */

export type ContextDay = {
  date: string;
  /** null — неделя не опубликована (не путать с «пар нет»: пустой массив). */
  lessons: ScheduleLesson[] | null;
};

export type ContextInput = {
  today: string;
  /** HH:MM в поясе группы: «какая следующая пара» без него не ответить. */
  now: string;
  phase: SemesterPhase;
  /** Чётность текущей недели, если неделя опубликована с ней. */
  parity: "upper" | "lower" | null;
  user: { fullName: string; role: Role };
  slotTimes: SlotTime[];
  /** Сегодня и завтра по порядку. */
  days: ContextDay[];
  /** Домашка с дедлайном сегодня…послезавтра, без дублей. */
  homework: ScheduleHomework[];
};

const ROLE_LABEL: Record<Role, string> = {
  student: "студент",
  moderator: "модератор группы (ведёт расписание и домашку)",
  admin: "админ приложения",
};

function phaseText(p: SemesterPhase): string | null {
  switch (p.kind) {
    case "study":
      return `идёт учёба, семестр «${p.semester.title}» до ${ddmm(p.semester.endsOn)}${p.semester.sessionStartsOn ? `, сессия с ${ddmm(p.semester.sessionStartsOn)}` : ""}`;
    case "session":
      return `сессия до ${ddmm(p.until)} (семестр «${p.semester.title}»)`;
    case "break":
      return `каникулы, семестр «${p.next.title}» начнётся ${ddmm(p.until)} (через ${p.days} дн.)`;
    case "over":
      return `семестр «${p.semester.title}» закончился, следующий ещё не заведён`;
    default:
      return null;
  }
}

/** Имя из «Фамилия Имя Отчество»; одно слово — как есть. Своя копия firstName из lib/utils: тот тянет tailwind-merge. */
const firstName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/);
  return parts[1] ?? parts[0] ?? "";
};

/**
 * Пара одной строкой — общий формат для контекста и инструмента get_schedule: вдвое короче JSON-объекта с теми же
 * полями, и модель видит пары одинаково, откуда бы они ни пришли. Короткое имя предмета — в скобках: по нему
 * модель связывает «матан» из вопроса и строку домашки с парой.
 */
export function lessonLine(l: ScheduleLesson): string {
  const kind = KIND_LABEL[l.kind];
  const room = l.room ? (/^\d/.test(l.room) ? `ауд. ${l.room}` : l.room) : "";
  return [
    `${l.slot}) ${l.startsAt}–${l.endsAt} ${l.title}`,
    l.subjectShort && l.subjectShort !== l.title ? ` (${l.subjectShort})` : "",
    kind ? `, ${kind.toLowerCase()}` : "",
    room ? `, ${room}` : "",
    l.teacherName ? `, ${l.teacherName}` : "",
    l.isCancelled ? " — ОТМЕНЕНА" : "",
    l.note ? `. Примечание: ${clipText(l.note.replace(/\s+/g, " "), 120)}` : "",
  ].join("");
}

function dayBlock(d: ContextDay, title: string): string {
  const head = `${title}, ${weekdayRu(d.date)} ${ddmm(d.date)}`;
  if (d.lessons === null) return `${head}: расписание ещё не опубликовано.`;
  if (d.lessons.length === 0) return `${head}: пар нет.`;
  return `${head}:\n${d.lessons.map((l) => `- ${lessonLine(l)}`).join("\n")}`;
}

function homeworkLine(h: ScheduleHomework): string {
  const what = h.title?.trim() || clipText(h.text, 90);
  return `- до ${weekdayRu(h.dueDate)} ${ddmm(h.dueDate)}, ${h.subjectShort ?? "без предмета"}: ${what}`;
}

/** Текст контекста для system-сообщения. Порядок — от самого нужного: дата, кто спрашивает, пары, домашка, звонки. */
export function buildContext(c: ContextInput): string {
  const phase = phaseText(c.phase);
  const lines = [
    "Контекст на момент вопроса (время группы — Оренбург, UTC+5):",
    `Сегодня ${weekdayRu(c.today, true)}, ${ddmm(c.today)}.${c.today.slice(0, 4)}, сейчас ${c.now}.${c.parity ? ` Неделя ${PARITY_LABEL[c.parity].toLowerCase()}.` : ""}`,
    phase ? `Семестр: ${phase}.` : null,
    `Спрашивает: ${firstName(c.user.fullName)}, ${ROLE_LABEL[c.user.role]}.`,
    "",
    ...c.days.map((d, i) => dayBlock(d, i === 0 ? "Пары сегодня" : i === 1 ? "Пары завтра" : "Пары")),
    "",
    c.homework.length
      ? `Домашка на ближайшие 3 дня (полный текст — инструмент get_homework):\n${c.homework.map(homeworkLine).join("\n")}`
      : "Домашки с дедлайном на ближайшие 3 дня нет.",
    c.slotTimes.length ? `Звонки: ${c.slotTimes.map((s) => `${s.slot}) ${s.start}–${s.end}`).join(", ")}.` : null,
  ];
  return lines.filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

// ---------- История ----------

/**
 * Бюджет истории в токенах (docs/AI-CHAT.md §6); оценка по длине, как estimateTokens. История уходит в каждый круг
 * модели заново, поэтому это главная переменная цены сообщения (lib/assistant/estimate.ts): 4000 вместо 6000 — это
 * примерно на пятую часть больше вопросов в тот же ресурс, а старшее не теряется, оно уходит в summary.
 */
export const HISTORY_TOKENS = 4000;

/** Сообщение истории текстом: вложения не пересылаются повторно, модели достаточно знать, что они были. */
export function historyText(m: Pick<ChatMessage, "content" | "attachments">): string {
  const marks = m.attachments.map((a) => (a.mime.startsWith("image/") ? "[фото]" : `[документ: ${a.name}]`));
  return [marks.join(" "), m.content.trim()].filter(Boolean).join("\n");
}

/**
 * Последние сообщения, укладывающиеся в бюджет, и всё, что старше, — dropped (его сожмут в summary после ответа).
 * Граница сплошная: одно длинное сообщение в середине обрезает всё, что раньше, иначе в модель попала бы история
 * с дыркой. Пустые (ошибка без текста) не отправляются, но и не мешают.
 */
export function fitHistory(history: readonly ChatMessage[], budget = HISTORY_TOKENS): { kept: ChatMessage[]; dropped: ChatMessage[] } {
  let used = 0;
  let boundary = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    const text = historyText(history[i]);
    const cost = text ? estimateTokens(text) : 0;
    if (used + cost > budget) break;
    used += cost;
    boundary = i;
  }
  return {
    kept: history.slice(boundary).filter((m) => historyText(m) !== ""),
    dropped: history.slice(0, boundary),
  };
}
