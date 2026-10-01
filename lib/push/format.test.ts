import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { buildNotification, dueDateLabel, genitiveName, joinAuthor, joinSentence, pushAuthorName, snippet, topicOf, weekRangeLabel } from "@/lib/push/format";

test("snippet: короткий текст остаётся как есть, переносы схлопываются", () => {
  strictEqual(snippet("  Завтра\n\nпары нет  "), "Завтра пары нет");
});

test("snippet: длинный текст режется по слову и с многоточием", () => {
  const s = snippet("а".repeat(50) + " " + "б".repeat(200), 60);
  strictEqual(s, "а".repeat(50) + "…");
  strictEqual(s.length <= 61, true);
});

test("snippet: слова нет — режем как есть, но не длиннее лимита", () => {
  strictEqual(snippet("я".repeat(300), 20), "я".repeat(20) + "…");
});

test("snippet: хвостовая пунктуация не липнет к многоточию", () => {
  strictEqual(snippet("Сдаём деньги на подарок — кто ещё не сдал, сдайте", 26), "Сдаём деньги на подарок…");
});

test("snippet: многоточие и короткое тире в месте обрезки не удваиваются", () => {
  // Набор хвостовых знаков общий с joinSentence: пока у snippet не было «…» и «–», текст, обрезанный
  // по слову с многоточием, получал второе — «…потом……».
  strictEqual(
    snippet("Темы к зачёту уточним позже, полный список будет потом… пока читаем конспект", 56),
    "Темы к зачёту уточним позже, полный список будет потом…",
  );
  strictEqual(snippet("Сдаём на подарок – кто ещё не сдал, сдайте", 20), "Сдаём на подарок…");
});

test("склейка: точку ставим только там, где заголовок её не поставил сам", () => {
  strictEqual(joinSentence("Контрольная", "Повторить главы"), "Контрольная. Повторить главы");
  strictEqual(joinSentence("Контрольная.", "Повторить главы"), "Контрольная. Повторить главы");
  strictEqual(joinSentence("Зачёт?", "Повторить главы"), "Зачёт? Повторить главы");
  strictEqual(joinSentence("Внимание!", "Повторить главы"), "Внимание! Повторить главы");
  strictEqual(joinSentence("Ну и ну…", "Повторить главы"), "Ну и ну… Повторить главы");
  strictEqual(joinSentence("К среде:", "Повторить главы"), "К среде: Повторить главы");
});

test("склейка: заголовка нет — остаётся один текст, без ведущей точки и пробела", () => {
  strictEqual(joinSentence(null, "Повторить главы"), "Повторить главы");
  strictEqual(joinSentence(undefined, "Повторить главы"), "Повторить главы");
  strictEqual(joinSentence("", "Повторить главы"), "Повторить главы");
  strictEqual(joinSentence("   ", "Повторить главы"), "Повторить главы");
});

test("склейка: заголовок из одних знаков препинания — это отсутствие заголовка", () => {
  // Zod минимальной длины для title не требует, так что «.» или «?» долетает до уведомления как настоящий
  // заголовок и даёт «Максим: . Учебник стр. 45». Заголовок есть, только если после trim осталась буква или цифра.
  strictEqual(joinSentence(".", "Учебник стр. 45"), "Учебник стр. 45");
  strictEqual(joinSentence("?", "Сбор в 9"), "Сбор в 9");
  strictEqual(joinSentence("…", "Сбор в 9"), "Сбор в 9");
  strictEqual(joinSentence("  -- ", "Сбор в 9"), "Сбор в 9");
  strictEqual(joinSentence(" «» ", "Сбор в 9"), "Сбор в 9");
});

test("склейка: цифра делает заголовок осмысленным", () => {
  // «1)» и «§5» — нормальные заголовки конспекта: букв нет, но цифра есть, выбрасывать их нельзя.
  strictEqual(joinSentence("1)", "Повторить главы"), "1). Повторить главы");
  strictEqual(joinSentence("§5", "Повторить главы"), "§5. Повторить главы");
  strictEqual(joinSentence("A", "Повторить главы"), "A. Повторить главы");
});

test("склейка: точка не лезет за закрывающую кавычку, но после скобки нужна", () => {
  // Последний символ у заголовка в кавычках — сама кавычка, поэтому смотрим на последний ЗНАЧАЩИЙ символ:
  // по-русски после «?»» и «!»» точка не ставится.
  strictEqual(joinSentence("«Пары отменили?»", "Сбор в 9"), "«Пары отменили?» Сбор в 9");
  strictEqual(joinSentence("«Зачёт!»", "Повторить главы"), "«Зачёт!» Повторить главы");
  strictEqual(joinSentence('"Зачёт?"', "Повторить главы"), '"Зачёт?" Повторить главы');
  strictEqual(joinSentence("“Зачёт?”", "Повторить главы"), "“Зачёт?” Повторить главы");
  // Внутри кавычек знака нет — точка нужна, и снаружи кавычек.
  strictEqual(joinSentence("«Война и мир»", "Читаем к пятнице"), "«Война и мир». Читаем к пятнице");
  // Скобка ведёт себя иначе: знак внутри относится только к вставке, само предложение точку требует.
  strictEqual(joinSentence("(важно!)", "Сбор в 9"), "(важно!). Сбор в 9");
});

test("новость: заголовок с именем автора, в теле — заголовок и начало текста", () => {
  const n = buildNotification({ kind: "news", author: "Максим", title: "Пары отменили", body: "Завтра первой пары не будет" });
  strictEqual(n.title, "Новость от Максима");
  strictEqual(n.body, "Пары отменили. Завтра первой пары не будет");
  strictEqual(n.url, "/group/news");
});

test("новость без заголовка: тело — сам текст", () => {
  strictEqual(buildNotification({ kind: "news", author: "Аня", body: "Сбор в 9" }).body, "Сбор в 9");
});

test("уведомление: заголовок из одних знаков не доезжает до экрана блокировки", () => {
  strictEqual(
    buildNotification({ kind: "homework", id: "h7", author: "Максим", subject: null, dueDate: "2026-09-15", title: ".", body: "Учебник стр. 45" }).body,
    "Максим: Учебник стр. 45",
  );
  strictEqual(buildNotification({ kind: "news", author: "Аня", title: "?", body: "Сбор в 9" }).body, "Сбор в 9");
  strictEqual(buildNotification({ kind: "news", author: "Аня", title: "«Пары отменили?»", body: "Сбор в 9" }).body, "«Пары отменили?» Сбор в 9");
});

test("новость: заголовок со своим знаком не удваивает пунктуацию", () => {
  strictEqual(buildNotification({ kind: "news", author: "Аня", title: "Пары отменили?", body: "Ждём подтверждения" }).body, "Пары отменили? Ждём подтверждения");
  strictEqual(buildNotification({ kind: "news", author: "Аня", title: "Важно!", body: "Сбор в 9" }).body, "Важно! Сбор в 9");
  strictEqual(buildNotification({ kind: "news", author: "Аня", title: "   ", body: "Сбор в 9" }).body, "Сбор в 9");
});

test("домашка: в заголовке сперва дедлайн, потом предмет; в теле — автор и текст, ссылка на саму запись", () => {
  const n = buildNotification({ kind: "homework", id: "h1", author: "Максим", subject: "Матан", dueDate: "2026-09-15", body: "Учебник стр. 45, задачи 1–10" });
  // Дата первой: заголовок на экране блокировки обрезается, и терять надо название предмета, а не дедлайн.
  strictEqual(n.title, "Задали к 15 сентября: Матан");
  // Имя без глагола: «добавил/добавила» угадывать нечем, а «Максим: …» верно для любого автора.
  strictEqual(n.body, "Максим: Учебник стр. 45, задачи 1–10");
  strictEqual(n.url, "/hw/h1");
  // Свой тег, не общий с новостями: с общим одно уведомление молча заменило бы другое на экране блокировки.
  strictEqual(n.tag, "homework");
});

test("домашка без предмета: заголовок всё равно осмысленный, заголовок записи — в начале тела", () => {
  const n = buildNotification({ kind: "homework", id: "h2", author: "Аня", subject: null, dueDate: "2026-09-01", title: "Контрольная", body: "Повторить главы 1–3" });
  strictEqual(n.title, "Задали к 1 сентября");
  strictEqual(n.body, "Аня: Контрольная. Повторить главы 1–3");
});

test("домашка: пустой предмет — это отсутствие предмета, а не пробел в заголовке", () => {
  for (const subject of ["", "   "]) {
    const n = buildNotification({ kind: "homework", id: "h3", author: "Аня", subject, dueDate: "2026-09-01", body: "Повторить главы" });
    strictEqual(n.title, "Задали к 1 сентября", JSON.stringify(subject));
  }
  // Пробелы вокруг настоящего названия тоже не должны доезжать до экрана блокировки.
  strictEqual(buildNotification({ kind: "homework", id: "h4", author: "Аня", subject: " Матан ", dueDate: "2026-09-01", body: "Повторить главы" }).title, "Задали к 1 сентября: Матан");
});

test("домашка: заголовок записи со знаком не удваивает пунктуацию в теле", () => {
  const n = buildNotification({ kind: "homework", id: "h5", author: "Максим", subject: "Матан", dueDate: "2026-09-15", title: "Зачёт?", body: "Повторить главы 1–3" });
  strictEqual(n.body, "Максим: Зачёт? Повторить главы 1–3");
  const dot = buildNotification({ kind: "homework", id: "h6", author: "Максим", subject: "Матан", dueDate: "2026-09-15", title: "Контрольная.", body: "Повторить главы 1–3" });
  strictEqual(dot.body, "Максим: Контрольная. Повторить главы 1–3");
});

test("перенос дедлайна: в заголовке новая дата и предмет, в теле — автор и старая", () => {
  const n = buildNotification({ kind: "hw_due_moved", id: "h8", author: "Максим", subject: "Матан", prevDueDate: "2026-09-18", dueDate: "2026-09-16" });
  // Тот же порядок, что у «Задали к 15 сентября: Матан», и такой же безличный глагол: пола в профиле нет.
  strictEqual(n.title, "Домашку перенесли на 16 сентября: Матан");
  strictEqual(n.body, "Максим. Было 18 сентября");
  strictEqual(n.url, "/hw/h8");
  // Тег свой не ради экрана блокировки: send.ts дописывает к тегу время отправки, и затирания не бывает ни при
  // каком теге. Тег — вид события, «Перенесли» и «Задали» не смешиваем.
  strictEqual(n.tag, "homework-due");
  strictEqual(topicOf("hw_due_moved"), "homework");
});

test("перенос дедлайна: без предмета заголовок всё равно осмысленный", () => {
  const n = buildNotification({ kind: "hw_due_moved", id: "h9", author: "Аня", subject: null, prevDueDate: "2026-09-01", dueDate: "2026-10-05" });
  strictEqual(n.title, "Домашку перенесли на 5 октября");
  strictEqual(n.body, "Аня. Было 1 сентября");
  // Пустое короткое название предмета — то же самое, что его отсутствие.
  for (const subject of ["", "   "]) {
    strictEqual(
      buildNotification({ kind: "hw_due_moved", id: "h9", author: "Аня", subject, prevDueDate: "2026-09-01", dueDate: "2026-10-05" }).title,
      "Домашку перенесли на 5 октября",
      JSON.stringify(subject),
    );
  }
});

test("перенос дедлайна внутри года: и вперёд, и ближе, и без года в тексте", () => {
  const later = buildNotification({ kind: "hw_due_moved", id: "h10", author: "Максим", subject: "Матан", prevDueDate: "2026-09-15", dueDate: "2026-09-22" });
  strictEqual(later.title, "Домашку перенесли на 22 сентября: Матан");
  strictEqual(later.body, "Максим. Было 15 сентября");
  const earlier = buildNotification({ kind: "hw_due_moved", id: "h10", author: "Максим", subject: "Матан", prevDueDate: "2026-09-15", dueDate: "2026-09-09" });
  strictEqual(earlier.title, "Домашку перенесли на 9 сентября: Матан");
  strictEqual(earlier.body, "Максим. Было 15 сентября");
  // Год у обеих дат один — печатать его незачем, в дедлайне ближайших недель он только шум.
  for (const n of [later, earlier]) strictEqual(`${n.title} ${n.body}`.includes("2026"), false, n.title);
});

test("перенос дедлайна через Новый год: год виден у обеих дат, в обе стороны", () => {
  // Без года «…перенесли на 3 января. Было 28 декабря» читается как перенос на девять месяцев НАЗАД, хотя срок
  // сдвинули на неделю вперёд. Обе даты на руках, поэтому сравнение чистое и «сегодня» для него не нужно.
  const forward = buildNotification({ kind: "hw_due_moved", id: "h13", author: "Максим", subject: "Матан", prevDueDate: "2026-12-28", dueDate: "2027-01-03" });
  strictEqual(forward.title, "Домашку перенесли на 3 января 2027: Матан");
  strictEqual(forward.body, "Максим. Было 28 декабря 2026");
  // Назад — ровно так же: год нужен обеим датам, иначе «…перенесли на 28 декабря. Было 3 января».
  const back = buildNotification({ kind: "hw_due_moved", id: "h13", author: "Максим", subject: "Матан", prevDueDate: "2027-01-03", dueDate: "2026-12-28" });
  strictEqual(back.title, "Домашку перенесли на 28 декабря 2026: Матан");
  strictEqual(back.body, "Максим. Было 3 января 2027");
});

test("перенос дедлайна на тот же день другого года: две одинаковые даты больше не выходят", () => {
  const n = buildNotification({ kind: "hw_due_moved", id: "h14", author: "Максим", subject: null, prevDueDate: "2026-09-15", dueDate: "2027-09-15" });
  strictEqual(n.title, "Домашку перенесли на 15 сентября 2027");
  strictEqual(n.body, "Максим. Было 15 сентября 2026");
});

test("перенос дедлайна на ту же дату: «Было» не повторяет новую дату", () => {
  // Сервер такой пуш слать не должен — переносить не на что. Но если событие всё же соберут, текст не ломается:
  // «…перенесли на 15 сентября. Было 15 сентября» выглядит сбоем, а сказать тут просто нечего — остаётся имя.
  const n = buildNotification({ kind: "hw_due_moved", id: "h15", author: "Максим", subject: "Матан", prevDueDate: "2026-09-15", dueDate: "2026-09-15" });
  strictEqual(n.title, "Домашку перенесли на 15 сентября: Матан");
  strictEqual(n.body, "Максим");
});

test("перенос дедлайна: имя автора остаётся при любом нике", () => {
  const body = (author: string) =>
    buildNotification({ kind: "hw_due_moved", id: "h16", author, subject: null, prevDueDate: "2026-09-15", dueDate: "2026-09-17" }).body;
  strictEqual(body("Максим"), "Максим. Было 15 сентября");
  // Ник пишет человек, «Батут!» встречается: пунктуацию не удваиваем.
  strictEqual(body("Батут!"), "Батут! Было 15 сентября");
  // Ник без букв и цифр — тоже имя. Через joinSentence он считался бы отсутствующим заголовком, и автор молча
  // исчезал бы из тела, а больше его в этом уведомлении нет нигде.
  strictEqual(body("🔥"), "🔥. Было 15 сентября");
  strictEqual(body("!!!"), "!!! Было 15 сентября");
  // Пробелы по краям ника до экрана блокировки не доезжают.
  strictEqual(body("  Батут "), "Батут. Было 15 сентября");
});

test("склейка имени: имя — не заголовок, из одних знаков оно остаётся", () => {
  // HAS_WORD_CHAR — правило для заголовка ЗАПИСИ: «.» там означает отсутствие заголовка. К имени оно неприменимо.
  strictEqual(joinSentence("🔥", "Было 15 сентября"), "Было 15 сентября");
  strictEqual(joinAuthor("🔥", "Было 15 сентября"), "🔥. Было 15 сентября");
  strictEqual(joinAuthor("Максим", "Было 15 сентября"), "Максим. Было 15 сентября");
  strictEqual(joinAuthor("Батут!", "Было 15 сентября"), "Батут! Было 15 сентября");
  strictEqual(joinAuthor("Ну и ну…", "Было 15 сентября"), "Ну и ну… Было 15 сентября");
  // Точка встаёт снаружи кавычек, как и у заголовка записи.
  strictEqual(joinAuthor("«Батут»", "Было 15 сентября"), "«Батут». Было 15 сентября");
  // Имени нет вовсе — остаётся одна фраза, без ведущей точки и пробела.
  strictEqual(joinAuthor("", "Было 15 сентября"), "Было 15 сентября");
  strictEqual(joinAuthor("   ", "Было 15 сентября"), "Было 15 сентября");
});

test("перенос дедлайна: новая дата влезает в 40 символов заголовка — и с годом тоже", () => {
  const long = "Основы российской государственности";
  const n = buildNotification({ kind: "hw_due_moved", id: "h12", author: "Максим", subject: long, prevDueDate: "2026-09-15", dueDate: "2026-09-17" });
  strictEqual(n.title, `Домашку перенесли на 17 сентября: ${long}`);
  // На экране блокировки iPhone видно около 40 символов заголовка: обрезаться должен хвост названия предмета,
  // но не дата. «Домашку перенесли на » — 21 символ, самая длинная дата с годом («30 сентября 2026») — 16: 37 < 40.
  strictEqual(n.title.slice(0, 40).includes("17 сентября"), true, n.title.slice(0, 40));
  const withYear = buildNotification({ kind: "hw_due_moved", id: "h12", author: "Максим", subject: long, prevDueDate: "2027-01-03", dueDate: "2026-12-28" });
  strictEqual(withYear.title.slice(0, 40).includes("28 декабря 2026"), true, withYear.title.slice(0, 40));
  // Все месяцы в обоих режимах: год в заголовке появляется, когда годы дат разошлись.
  for (const prev of ["2026-01-01", "2027-01-01"]) {
    for (let m = 1; m <= 12; m++) {
      const iso = `2026-${String(m).padStart(2, "0")}-28`;
      const title = buildNotification({ kind: "hw_due_moved", id: "h12", author: "Максим", subject: long, prevDueDate: prev, dueDate: iso }).title;
      const label = dueDateLabel(iso, !prev.startsWith("2026-"));
      strictEqual(title.slice(0, 40).includes(label), true, `${title.slice(0, 40)} | ${label}`);
    }
  }
});

test("дедлайн: родительный падеж месяца, день без ведущего нуля", () => {
  strictEqual(dueDateLabel("2026-09-15"), "15 сентября");
  strictEqual(dueDateLabel("2026-01-05"), "5 января");
  strictEqual(dueDateLabel("2026-12-31"), "31 декабря");
});

test("дедлайн: год печатается только когда его попросили", () => {
  strictEqual(dueDateLabel("2026-09-15", true), "15 сентября 2026");
  strictEqual(dueDateLabel("2027-01-03", true), "3 января 2027");
  strictEqual(dueDateLabel("2026-09-15", false), "15 сентября");
  // Непонятная строка остаётся собой в обоих режимах: приписывать к ней год неоткуда.
  strictEqual(dueDateLabel("завтра", true), "завтра");
});

test("дедлайн: непонятная строка возвращается как есть, а не мусором", () => {
  for (const bad of ["2026-13-01", "2026-00-10", "2026-09-00", "завтра", ""]) strictEqual(dueDateLabel(bad), bad, bad);
});

test("анонимный вопрос: в заголовке нет имени", () => {
  const n = buildNotification({ kind: "anon_question", body: "Когда зачёт?" });
  strictEqual(n.title, "Анонимный вопрос");
  strictEqual(n.body, "Когда зачёт?");
  strictEqual(n.url, "/group/questions");
});

test("ответ на вопрос и опрос ведут на свои экраны", () => {
  strictEqual(buildNotification({ kind: "anon_answer", author: "Максим", body: "В пятницу" }).url, "/group/questions");
  // Заголовок не должен угадывать пол: «Аня ответил» и «Аня ответила» одинаково плохи, пола в профиле нет.
  strictEqual(buildNotification({ kind: "anon_answer", author: "Аня", body: "В пятницу" }).title, "Ответ от Ани");
  strictEqual(buildNotification({ kind: "poll", author: "Максим", question: "Идём в кино?" }).url, "/group/polls");
  strictEqual(buildNotification({ kind: "poll", author: "Максим", question: "Идём в кино?" }).title, "Опрос от Максима");
});

test("темы событий", () => {
  deepStrictEqual(
    (["news", "homework", "hw_due_moved", "anon_question", "anon_answer", "poll", "lesson_cancelled", "lesson_restored", "lesson_changed", "week_published"] as const).map(topicOf),
    ["news", "homework", "homework", "questions", "questions", "polls", "schedule", "schedule", "schedule", "schedule"],
  );
});

test("отмена пары: глагол без рода, дата сразу за ним, короткое имя предмета в заголовке, полное — в теле", () => {
  const n = buildNotification({ kind: "lesson_cancelled", title: "Математический анализ", subject: "Матан", date: "2026-10-02", startsAt: "10:00" });
  strictEqual(n.title, "Отменили пару 2 октября: Матан");
  strictEqual(n.body, "10:00 · Математический анализ");
  // Ведёт в сам день: там пара зачёркнута с бейджем «отменена».
  strictEqual(n.url, "/s/d/2026-10-02");
  strictEqual(n.tag, "schedule");
  strictEqual(topicOf("lesson_cancelled"), "schedule");
});

test("отмена пары без короткого имени: в заголовке полное название, в теле — только время", () => {
  const n = buildNotification({ kind: "lesson_cancelled", title: "Философия", subject: null, date: "2026-10-02", startsAt: "08:30" });
  strictEqual(n.title, "Отменили пару 2 октября: Философия");
  strictEqual(n.body, "08:30");
  // Пустое короткое имя (short_name стёрли руками) и поле без значения — одно и то же.
  for (const subject of ["", "   ", undefined]) {
    const m = buildNotification({ kind: "lesson_cancelled", title: "Философия", subject, date: "2026-10-02", startsAt: "08:30" });
    strictEqual(m.title, "Отменили пару 2 октября: Философия", JSON.stringify(subject));
    strictEqual(m.body, "08:30", JSON.stringify(subject));
  }
});

test("отмена пары: длинное название обрезается хвостом, дата остаётся в первых 40 символах", () => {
  const long = "Основы российской государственности";
  const n = buildNotification({ kind: "lesson_cancelled", title: long, subject: null, date: "2026-09-30", startsAt: "11:50" });
  strictEqual(n.title, `Отменили пару 30 сентября: ${long}`);
  // «Отменили пару » — 14 символов, самая длинная дата («30 сентября») — 11: дата целиком в видимой части заголовка.
  strictEqual(n.title.slice(0, 40).includes("30 сентября"), true, n.title.slice(0, 40));
  // Пара вовсе без названия — заголовок без висящего двоеточия, тело не ломается.
  const bare = buildNotification({ kind: "lesson_cancelled", title: "  ", subject: "", date: "2026-09-30", startsAt: "11:50" });
  strictEqual(bare.title, "Отменили пару 30 сентября");
  strictEqual(bare.body, "11:50");
});

test("возврат пары: та же форма, что у отмены, со своим глаголом", () => {
  const n = buildNotification({ kind: "lesson_restored", title: "Математический анализ", subject: "Матан", date: "2026-10-02", startsAt: "10:00" });
  strictEqual(n.title, "Вернули пару 2 октября: Матан");
  strictEqual(n.body, "10:00 · Математический анализ");
  strictEqual(n.url, "/s/d/2026-10-02");
  strictEqual(n.tag, "schedule");
  strictEqual(buildNotification({ kind: "lesson_restored", title: "Философия", date: "2026-10-02", startsAt: "08:30" }).title, "Вернули пару 2 октября: Философия");
});

test("изменение пары: в теле — что поменялось, а без этого честное «проверь расписание»", () => {
  const n = buildNotification({ kind: "lesson_changed", title: "Математический анализ", subject: "Матан", date: "2026-10-02", startsAt: "10:00", what: "аудитория 305" });
  strictEqual(n.title, "Изменили пару 2 октября: Матан");
  strictEqual(n.body, "10:00 · аудитория 305");
  strictEqual(n.url, "/s/d/2026-10-02");
  strictEqual(n.tag, "schedule");
  // Новая пара в опубликованной неделе — тот же вид события, разница только в what.
  strictEqual(buildNotification({ kind: "lesson_changed", title: "Физкультура", date: "2026-10-02", startsAt: "13:50", what: "добавлена пара" }).body, "13:50 · добавлена пара");
  for (const what of [undefined, null, "", "   "]) {
    const m = buildNotification({ kind: "lesson_changed", title: "Философия", date: "2026-10-02", startsAt: "08:30", what });
    strictEqual(m.title, "Изменили пару 2 октября: Философия", JSON.stringify(what));
    strictEqual(m.body, "08:30 · проверь расписание", JSON.stringify(what));
  }
});

test("изменение пары: длинная причина режется по слову, а не посреди", () => {
  const what = "аудитория 305, преподаватель Иванова Ирина Ивановна, " + "подробности ".repeat(20);
  const n = buildNotification({ kind: "lesson_changed", title: "Матан", date: "2026-10-02", startsAt: "10:00", what });
  strictEqual(n.body.length <= 141, true, String(n.body.length));
  strictEqual(n.body.startsWith("10:00 · аудитория 305, преподаватель Иванова Ирина Ивановна"), true, n.body);
  strictEqual(n.body.endsWith("…"), true, n.body);
});

test("публикация недели: диапазон как в шапке недели, ссылка на саму неделю", () => {
  const n = buildNotification({ kind: "week_published", startsOn: "2026-10-05" });
  strictEqual(n.title, "Расписание на 5–10 окт готово");
  strictEqual(n.body, "Посмотри неделю — что-то могло поменяться");
  strictEqual(n.url, "/s/w/2026-10-05");
  strictEqual(n.tag, "schedule-week");
  strictEqual(topicOf("week_published"), "schedule");
  strictEqual(buildNotification({ kind: "week_published", startsOn: "2026-09-28" }).title, "Расписание на 28 сент — 3 окт готово");
});

test("диапазон недели: понедельник–суббота, сокращения как у date-fns ru, стык месяцев и года", () => {
  strictEqual(weekRangeLabel("2026-10-05"), "5–10 окт");
  strictEqual(weekRangeLabel("2026-09-28"), "28 сент — 3 окт");
  strictEqual(weekRangeLabel("2026-12-28"), "28 дек — 2 янв");
  strictEqual(weekRangeLabel("2026-03-02"), "2–7 мар");
  strictEqual(weekRangeLabel("2026-05-04"), "4–9 мая");
  strictEqual(weekRangeLabel("2026-02-23"), "23–28 февр");
  strictEqual(weekRangeLabel("2026-11-02"), "2–7 нояб");
  // Непонятная строка — как есть, не «NaN–NaN undefined».
  for (const bad of ["2026-13-01", "2026-09-00", "понедельник", ""]) strictEqual(weekRangeLabel(bad), bad, bad);
});

test("имя автора: ник важнее, иначе имя из «Фамилия Имя»", () => {
  strictEqual(pushAuthorName({ fullName: "Батутин Максим", nickname: null }), "Максим");
  strictEqual(pushAuthorName({ fullName: "Батутин Максим", nickname: "  Батут " }), "Батут");
  strictEqual(pushAuthorName({ fullName: "Одинслово", nickname: "  " }), "Одинслово");
});

test("родительный падеж: имена склоняются, латиница и прочее — как есть", () => {
  const pairs: [string, string][] = [
    ["Максим", "Максима"],
    ["Андрей", "Андрея"],
    ["Игорь", "Игоря"],
    ["Илья", "Ильи"],
    ["Мария", "Марии"],
    ["Настя", "Насти"],
    ["Анна", "Анны"],
    ["Ольга", "Ольги"],
    ["Никита", "Никиты"],
    ["Наташа", "Наташи"],
    ["Данило", "Данило"],
    ["Nick", "Nick"],
    ["🙂", "🙂"],
  ];
  for (const [from, to] of pairs) strictEqual(genitiveName(from), to, from);
});

test("родительный падеж: женские имена на «-ь» — через «-и», мужские по-прежнему через «-я»", () => {
  const pairs: [string, string][] = [
    ["Любовь", "Любови"],
    ["Нинель", "Нинели"],
    ["Рахиль", "Рахили"],
    ["Эсфирь", "Эсфири"],
    ["Игорь", "Игоря"],
    ["Даниль", "Даниля"],
  ];
  for (const [from, to] of pairs) strictEqual(genitiveName(from), to, from);
});

test("родительный падеж: беглая гласная — словарём, регистр первой буквы как в нике", () => {
  const pairs: [string, string][] = [
    ["Лев", "Льва"],
    ["Павел", "Павла"],
    ["Пётр", "Петра"],
    ["Петр", "Петра"],
    [" Лев ", "Льва"],
    ["лев", "льва"],
    // Похожие, но не из словаря, — обычное правило.
    ["Левон", "Левона"],
  ];
  for (const [from, to] of pairs) strictEqual(genitiveName(from), to, from);
  strictEqual(buildNotification({ kind: "news", author: "Любовь", body: "Сбор в 9" }).title, "Новость от Любови");
  strictEqual(buildNotification({ kind: "poll", author: "Лев", question: "Идём?" }).title, "Опрос от Льва");
});
