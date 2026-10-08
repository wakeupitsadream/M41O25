import type { Mode } from "../db/store.js";
import { cb, grid, keyboard } from "../max/keyboard.js";
import type { Button, KeyboardAttachment } from "../max/types.js";

export const MODE_INFO: Record<Mode, { icon: string; title: string; hint: string; working: string }> = {
  solve: { icon: "🧮", title: "Решатель", hint: "решение по шагам с ответом и проверкой", working: "🧮 Решаю…" },
  tutor: { icon: "🧑‍🏫", title: "Репетитор", hint: "наводит подсказками, чтобы ты решил сам", working: "🧑‍🏫 Думаю, с чего начать…" },
  ticket: { icon: "🎓", title: "Билет", hint: "ответ на вопрос билета: устно за 30 секунд, план, термины", working: "🎓 Готовлю ответ…" },
  chat: { icon: "💬", title: "Болталка", hint: "просто поговорить, на «ты» и с юмором", working: "💬 Печатаю…" },
};

export const modeLabel = (m: Mode) => `${MODE_INFO[m].icon} ${MODE_INFO[m].title}`;

export function modePickerText(current: Mode): string {
  const lines = (Object.keys(MODE_INFO) as Mode[]).map(
    (m) => `${m === current ? "▶️" : "▫️"} <b>${MODE_INFO[m].icon} ${MODE_INFO[m].title}</b> — ${MODE_INFO[m].hint}`,
  );
  return `Режим ответа:\n\n${lines.join("\n")}\n\nФото задачи в любом режиме можно решить, проверить или законспектировать.`;
}

export function modePickerKeyboard(current: Mode): KeyboardAttachment {
  const btn = (m: Mode): Button => cb(`${m === current ? "✓ " : ""}${modeLabel(m)}`, `m:${m}`);
  return keyboard([
    [btn("solve"), btn("tutor")],
    [btn("ticket"), btn("chat")],
  ]);
}

export type PhotoAction = "solve" | "check" | "notes" | "ocr" | "chat";

export const PHOTO_WORKING: Record<Exclude<PhotoAction, "solve" | "chat">, string> = {
  check: "✅ Проверяю решение…",
  notes: "📝 Делаю конспект…",
  ocr: "🔤 Распознаю текст…",
};

export function photoPromptText(count: number): string {
  return count > 1 ? `📷 Фото: ${count}. Что с ними сделать?` : "📷 Что сделать с фото?";
}

export function photoKeyboard(pendingId: string, mode: Mode): KeyboardAttachment {
  const solveLabel = mode === "tutor" ? "🧑‍🏫 Разобрать" : mode === "ticket" ? "🎓 Ответить" : "🧮 Решить";
  return keyboard([
    [cb(solveLabel, `p:${pendingId}:solve`), cb("✅ Проверить решение", `p:${pendingId}:check`)],
    [cb("📝 Конспект", `p:${pendingId}:notes`), cb("🔤 Текст с фото", `p:${pendingId}:ocr`)],
    [cb("💬 Обсудить", `p:${pendingId}:chat`), cb("✖️ Отмена", `p:${pendingId}:cancel`)],
  ]);
}

export type Followup = "short" | "more" | "simple" | "quiz" | "solve";

export const FOLLOWUP_WORKING: Record<Followup, string> = {
  short: "✂️ Сокращаю…",
  more: "🔍 Расписываю подробнее…",
  simple: "🙂 Объясняю проще…",
  quiz: "🧠 Придумываю вопросы…",
  solve: "🧮 Решаю полностью…",
};

export const FOLLOWUP_LABEL: Record<Followup, string> = {
  short: "Короче",
  more: "Подробнее",
  simple: "Проще",
  quiz: "Проверь меня",
  solve: "Покажи решение",
};

/** Кнопки под ответом: зависят от того, что это был за ответ. */
export function answerKeyboard(answerId: string, kind: "solve" | "tutor" | "ticket" | "check" | "notes"): KeyboardAttachment {
  const f = (act: Followup, text: string) => cb(text, `f:${answerId}:${act}`);
  const tail = [f("quiz", "🧠 Проверь меня"), cb("🆕 Заново", "new"), cb("⚙️ Режим", "menu")];
  switch (kind) {
    case "tutor":
      return keyboard([[f("solve", "🧮 Покажи решение"), f("simple", "🙂 Проще")], tail]);
    case "check":
      return keyboard([[f("more", "🔍 Подробнее"), f("simple", "🙂 Проще")], [cb("🆕 Заново", "new"), cb("⚙️ Режим", "menu")]]);
    case "notes":
      return keyboard([[f("short", "✂️ Короче"), f("quiz", "🧠 Проверь меня")]]);
    default:
      return keyboard([[f("short", "✂️ Короче"), f("more", "🔍 Подробнее"), f("simple", "🙂 Проще")], tail]);
  }
}

export function tasksKeyboard(tasksId: string, count: number): KeyboardAttachment {
  const numbers = Array.from({ length: Math.min(count, 8) }, (_, i) => cb(String(i + 1), `t:${tasksId}:${i + 1}`));
  return keyboard([[cb("Все по порядку", `t:${tasksId}:all`)], ...grid(numbers, 4)]);
}

export const quizKeyboard = (quizId: string) => keyboard([[cb("👀 Показать ответы", `q:${quizId}`)]]);

export const BOT_COMMANDS = [
  { name: "mode", description: "Выбрать режим: решатель, репетитор, билет, болталка" },
  { name: "new", description: "Начать новую тему (забыть контекст)" },
  { name: "profile", description: "Профиль: курс, предметы, о себе" },
  { name: "status", description: "Какие модели доступны и лимиты" },
  { name: "help", description: "Что умеет бот" },
];

export const HELP_TEXT = [
  "<b>Что я умею</b>",
  "",
  "📷 <b>Фото</b> — пришли одно или несколько, выбери: решить, проверить твоё решение, конспект или текст с фото. Можно сразу с подписью: «реши 2 и 3».",
  "🎙 <b>Голосовые</b> — наговори вопрос, я распознаю и отвечу.",
  "↩️ <b>Ответ на сообщение</b> — уточняй прямо в ответ на мой ответ или своё фото.",
  "",
  "<b>Режимы</b> (/mode):",
  "🧮 Решатель — решение по шагам, ответ сразу сверху",
  "🧑‍🏫 Репетитор — подсказки, чтобы ты решил сам",
  "🎓 Билет — как ответить на вопрос устно",
  "💬 Болталка — просто поговорить",
  "",
  "Под ответом: ✂️ короче, 🔍 подробнее, 🙂 проще, 🧠 проверь меня.",
  "",
  "/new — новая тема · /profile — профиль · /status — модели и лимиты",
].join("\n");
