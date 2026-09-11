import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { buildNotification, dueDateLabel, genitiveName, joinSentence, pushAuthorName, snippet, topicOf } from "@/lib/push/format";

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

test("дедлайн: родительный падеж месяца, день без ведущего нуля", () => {
  strictEqual(dueDateLabel("2026-09-15"), "15 сентября");
  strictEqual(dueDateLabel("2026-01-05"), "5 января");
  strictEqual(dueDateLabel("2026-12-31"), "31 декабря");
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
    (["news", "homework", "anon_question", "anon_answer", "poll"] as const).map(topicOf),
    ["news", "homework", "questions", "questions", "polls"],
  );
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
