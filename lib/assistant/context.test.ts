import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext, fitHistory, historyText, lessonLine, type ContextInput } from "./context";
import { systemPrompt } from "./prompt";
import { estimateTokens } from "./pricing";
import type { ScheduleLesson } from "@/lib/schedule/types";
import type { ChatMessage } from "./types";

const SEM = { id: "s1", title: "Осень 2026", startsOn: "2026-08-31", endsOn: "2026-12-27", sessionStartsOn: "2026-12-14" };
const SLOTS = [
  { slot: 1, start: "08:30", end: "10:00" },
  { slot: 2, start: "10:10", end: "11:40" },
  { slot: 3, start: "12:10", end: "13:40" },
  { slot: 4, start: "13:50", end: "15:20" },
  { slot: 5, start: "15:30", end: "17:00" },
  { slot: 6, start: "17:10", end: "18:40" },
];

const lesson = (date: string, slot: number, title: string, extra: Partial<ScheduleLesson> = {}): ScheduleLesson => ({
  id: `${date}-${slot}`,
  date,
  slot,
  startsAt: SLOTS[slot - 1].start,
  endsAt: SLOTS[slot - 1].end,
  title,
  subjectId: null,
  subjectShort: null,
  subjectColor: null,
  room: "214",
  teacherName: "Иванова И.И.",
  kind: "lecture",
  note: null,
  isCancelled: false,
  modifiedAfterPublish: false,
  ...extra,
});

/** Плотный, но реалистичный день группы: 4 пары сегодня, 4 завтра, 5 записей домашки. */
const DEMO: ContextInput = {
  today: "2026-09-24",
  now: "11:32",
  phase: { kind: "study", semester: SEM },
  parity: "upper",
  user: { fullName: "Батутин Максим Андреевич", role: "admin" },
  slotTimes: SLOTS,
  days: [
    {
      date: "2026-09-24",
      lessons: [
        lesson("2026-09-24", 1, "Математический анализ", { subjectShort: "Матан" }),
        lesson("2026-09-24", 2, "Математический анализ", { kind: "practice" }),
        lesson("2026-09-24", 3, "Микроэкономика", { room: "305", teacherName: "Петров П.П.", isCancelled: true, note: "Преподаватель на конференции, отработка позже" }),
        lesson("2026-09-24", 4, "Английский язык", { kind: "practice", room: "118", teacherName: "Смирнова А.В." }),
      ],
    },
    {
      date: "2026-09-25",
      lessons: [
        lesson("2026-09-25", 1, "История России", { room: "402", teacherName: "Кузнецов С.Н." }),
        lesson("2026-09-25", 2, "Философия", { room: "310", teacherName: "Орлова Е.М." }),
        lesson("2026-09-25", 3, "Информатика", { kind: "lab", room: "207", teacherName: "Соколов Д.А." }),
        lesson("2026-09-25", 4, "Физическая культура", { kind: "practice", room: "Спортзал", teacherName: "Волков А.А." }),
      ],
    },
  ],
  homework: [
    { id: "h1", dueDate: "2026-09-24", lessonId: null, subjectId: null, subjectShort: "Англ", subjectColor: null, title: "Unit 3, упр. 4–7", text: "Unit 3, упражнения 4–7 письменно", done: false },
    { id: "h2", dueDate: "2026-09-25", lessonId: null, subjectId: null, subjectShort: "История", subjectColor: null, title: null, text: "Прочитать параграф 5, выписать даты реформ Петра I и подготовить доклад на 5 минут", done: false },
    { id: "h3", dueDate: "2026-09-25", lessonId: null, subjectId: null, subjectShort: "Инф", subjectColor: null, title: "Лаба 2", text: "Лабораторная 2: циклы", done: false },
    { id: "h4", dueDate: "2026-09-26", lessonId: null, subjectId: null, subjectShort: "Матан", subjectColor: null, title: "Пределы №112–130", text: "", done: false },
    { id: "h5", dueDate: "2026-09-26", lessonId: null, subjectId: null, subjectShort: "Микро", subjectColor: null, title: "Эссе про эластичность", text: "", done: false },
  ],
};

test("buildContext: дата, фаза, имя и роль, пары с отменой и примечанием, домашка, звонки", () => {
  const text = buildContext(DEMO);
  assert.match(text, /Сегодня четверг, 24\.09\.2026, сейчас 11:32\. Неделя верхняя\./);
  assert.match(text, /Семестр: идёт учёба, семестр «Осень 2026» до 27\.12, сессия с 14\.12\./);
  assert.match(text, /Спрашивает: Максим, админ приложения\./);
  assert.match(text, /Пары сегодня, чт 24\.09:\n- 1\) 08:30–10:00 Математический анализ \(Матан\), лекция, ауд\. 214, Иванова И\.И\./);
  assert.match(text, /3\) 12:10–13:40 Микроэкономика, лекция, ауд\. 305, Петров П\.П\. — ОТМЕНЕНА\. Примечание: Преподаватель на конференции/);
  assert.match(text, /Пары завтра, пт 25\.09:/);
  assert.match(text, /- до пт 25\.09, История: Прочитать параграф 5/);
  assert.match(text, /Звонки: 1\) 08:30–10:00, 2\) 10:10–11:40/);
});

test("buildContext: неопубликованная неделя, выходной, нет домашки, каникулы", () => {
  const text = buildContext({
    ...DEMO,
    phase: { kind: "break", until: "2027-02-09", days: 12, next: { ...SEM, title: "Весна 2027", startsOn: "2027-02-09" } },
    parity: null,
    days: [
      { date: "2026-09-26", lessons: [] },
      { date: "2026-09-27", lessons: null },
    ],
    homework: [],
  });
  assert.match(text, /Пары сегодня, сб 26\.09: пар нет\./);
  assert.match(text, /Пары завтра, вс 27\.09: расписание ещё не опубликовано\./);
  assert.match(text, /Домашки с дедлайном на ближайшие 3 дня нет\./);
  assert.match(text, /каникулы, семестр «Весна 2027» начнётся 09\.02 \(через 12 дн\.\)/);
  assert.ok(!text.includes("Неделя"));
});

test("контекст + системный промпт укладываются в цель 800–1500 токенов на плотном дне", (t) => {
  const prompt = estimateTokens(systemPrompt("М41О25"));
  const context = estimateTokens(buildContext(DEMO));
  t.diagnostic(`промпт ≈ ${prompt} + контекст ≈ ${context} = ${prompt + context} токенов`);
  assert.ok(prompt + context >= 800 && prompt + context <= 1500, `получилось ${prompt + context} токенов`);
});

test("lessonLine: «другое» без вида занятия, без аудитории и преподавателя", () => {
  assert.equal(lessonLine(lesson("2026-09-24", 5, "Классный час", { kind: "other", room: null, teacherName: null })), "5) 15:30–17:00 Классный час");
  // Аудитория-число — «ауд. 214», название места — как есть; короткое имя, совпадающее с названием, не дублируется.
  assert.equal(
    lessonLine(lesson("2026-09-24", 4, "Физра", { subjectShort: "Физра", kind: "practice", room: "Спортзал", teacherName: null })),
    "4) 13:50–15:20 Физра, практика, Спортзал",
  );
});

const msg = (id: string, role: ChatMessage["role"], content: string, attachments: ChatMessage["attachments"] = []): ChatMessage => ({
  id,
  role,
  content,
  attachments,
  strong: false,
  status: "done",
  createdAt: "2026-09-24T06:00:00.000Z",
});

test("historyText: вложения истории — пометками, без содержимого", () => {
  const m = msg("1", "user", "Проверь решение", [
    { id: "a", name: "IMG_1.jpg", mime: "image/jpeg", url: "/api/files/a" },
    { id: "b", name: "Лекция 3.pdf", mime: "application/pdf", url: "/api/files/b" },
  ]);
  assert.equal(historyText(m), "[фото] [документ: Лекция 3.pdf]\nПроверь решение");
});

test("fitHistory: свежие сообщения в бюджет, старшие — в dropped сплошным хвостом", () => {
  const h = [msg("1", "user", "а".repeat(3500)), msg("2", "assistant", "б".repeat(3500)), msg("3", "user", "в".repeat(35)), msg("4", "assistant", "")];
  // 3500 символов = 1000 токенов: в бюджет 1100 влезают «4» (пустое), «3» (10) и «2» (1000), «1» — нет.
  const { kept, dropped } = fitHistory(h, 1100);
  assert.deepEqual(
    kept.map((m) => m.id),
    ["2", "3"],
  );
  assert.deepEqual(
    dropped.map((m) => m.id),
    ["1"],
  );
  // Всё влезает — dropped пуст; ничего не влезает — всё в dropped.
  assert.equal(fitHistory(h, 10_000).dropped.length, 0);
  assert.deepEqual(
    fitHistory([msg("x", "user", "г".repeat(10_000))], 100).dropped.map((m) => m.id),
    ["x"],
  );
});
