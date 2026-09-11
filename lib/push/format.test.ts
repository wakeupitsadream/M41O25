import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { buildNotification, genitiveName, pushAuthorName, snippet, topicOf } from "@/lib/push/format";

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

test("новость: заголовок с именем автора, в теле — заголовок и начало текста", () => {
  const n = buildNotification({ kind: "news", author: "Максим", title: "Пары отменили", body: "Завтра первой пары не будет" });
  strictEqual(n.title, "Новость от Максима");
  strictEqual(n.body, "Пары отменили. Завтра первой пары не будет");
  strictEqual(n.url, "/group/news");
});

test("новость без заголовка: тело — сам текст", () => {
  strictEqual(buildNotification({ kind: "news", author: "Аня", body: "Сбор в 9" }).body, "Сбор в 9");
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
    (["news", "anon_question", "anon_answer", "poll"] as const).map(topicOf),
    ["news", "questions", "questions", "polls"],
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
