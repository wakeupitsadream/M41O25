import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFullName, looksLikeHeading, normalizeFullName, parseBirthday, planPeopleImport, splitColumns, splitLines, stripBullet } from "./people";

test("normalizeFullName: регистр, ё→е, двойные пробелы и неразрывный пробел", () => {
  assert.equal(normalizeFullName("Иванов  Иван"), "иванов иван");
  assert.equal(normalizeFullName("СЕМЁНОВА Алёна"), "семенова алена");
  assert.equal(normalizeFullName("Семенова Алена "), "семенова алена");
  assert.equal(normalizeFullName("Римский - Корсаков Пётр"), "римский-корсаков петр");
  assert.equal(normalizeFullName("«Иванов» Иван"), "иванов иван");
});

test("cleanFullName: пробелы прибраны, регистр как ввели, инициалы с точкой целы", () => {
  assert.equal(cleanFullName("  Иванов   Иван  "), "Иванов Иван");
  assert.equal(cleanFullName("ИВАНОВ Иван"), "ИВАНОВ Иван");
  assert.equal(cleanFullName("Иванов И.И."), "Иванов И.И.");
  assert.equal(cleanFullName("Иванов Иван,"), "Иванов Иван");
});

test("stripBullet: нумерация «1.», «1)», «12 -», маркеры списка", () => {
  assert.equal(stripBullet("1. Иванов Иван"), "Иванов Иван");
  assert.equal(stripBullet("1) Иванов Иван"), "Иванов Иван");
  assert.equal(stripBullet("1.Иванов Иван"), "Иванов Иван");
  assert.equal(stripBullet("12 - Иванов Иван"), "Иванов Иван");
  assert.equal(stripBullet("- Иванов"), "Иванов");
  assert.equal(stripBullet("• Иванов Иван"), "Иванов Иван");
  assert.equal(stripBullet("№3 Иванов Иван"), "Иванов Иван");
  assert.equal(stripBullet("Иванов Иван"), "Иванов Иван");
});

test("splitLines: переводы строки, «;», запятая как разделитель, дата после запятой остаётся с человеком", () => {
  assert.deepEqual(splitLines("Иванов Иван\n\nПетров Пётр"), ["Иванов Иван", "Петров Пётр"]);
  assert.deepEqual(splitLines("Иванов Иван; Петров Пётр"), ["Иванов Иван", "Петров Пётр"]);
  assert.deepEqual(splitLines("Иванов Иван, Петров Пётр"), ["Иванов Иван", "Петров Пётр"]);
  assert.deepEqual(splitLines("Иванов Иван, 01.02.2000"), ["Иванов Иван — 01.02.2000"]);
});

test("splitLines: «Фамилия, Имя Отчество» — один человек, а не два", () => {
  assert.deepEqual(splitLines("Иванов, Иван Иванович"), ["Иванов Иван Иванович"]);
  assert.deepEqual(splitLines("Иванов, Иван"), ["Иванов Иван"]);
  assert.deepEqual(splitLines("Иванов, Иван Иванович\nПетров, Пётр"), ["Иванов Иван Иванович", "Петров Пётр"]);
  // Нумерация не мешает узнать формат: до запятой всё равно одна фамилия.
  assert.deepEqual(splitLines("4. Семёнова, Алёна Сергеевна"), ["4. Семёнова Алёна Сергеевна"]);
  // Дата после фамилии — по-прежнему второй столбец, а не отчество.
  assert.deepEqual(splitLines("Иванов, 01.02.2000"), ["Иванов 01.02.2000"]);
  // А это всё ещё два человека: до запятой больше одного слова.
  assert.deepEqual(splitLines("Иванов Иван, Петров Пётр"), ["Иванов Иван", "Петров Пётр"]);
  assert.deepEqual(splitLines("Иванов, Иван Иванович, Петров Пётр"), ["Иванов", "Иван Иванович", "Петров Пётр"]);
});

test("planPeopleImport: список «Фамилия, Имя Отчество» не превращается в двойников", () => {
  const plan = planPeopleImport("Иванов, Иван Иванович\nСемёнова, Алёна Сергеевна");
  assert.deepEqual(
    plan.people.map((p) => p.fullName),
    ["Иванов Иван Иванович", "Семёнова Алёна Сергеевна"],
  );
  assert.equal(plan.counts.add, 2);
});

test("splitColumns: второй столбец через таб, « — » и дату в хвосте", () => {
  assert.deepEqual(splitColumns("Иванов Иван\t01.02.2000"), { name: "Иванов Иван", extra: "01.02.2000" });
  assert.deepEqual(splitColumns("Иванов Иван — 01.02"), { name: "Иванов Иван", extra: "01.02" });
  assert.deepEqual(splitColumns("Иванов Иван - 2000-02-01"), { name: "Иванов Иван", extra: "2000-02-01" });
  assert.deepEqual(splitColumns("Иванов Иван 01.02.2000"), { name: "Иванов Иван", extra: "01.02.2000" });
  assert.deepEqual(splitColumns("Римский-Корсаков Пётр"), { name: "Римский-Корсаков Пётр", extra: null });
});

test("splitColumns: двойная фамилия с пробелами вокруг дефиса остаётся целой", () => {
  assert.deepEqual(splitColumns("Римский - Корсаков Пётр"), { name: "Римский - Корсаков Пётр", extra: null });
  assert.deepEqual(splitColumns("Иванова - Петрова Мария 07.03.2006"), { name: "Иванова - Петрова Мария", extra: "07.03.2006" });
  assert.deepEqual(splitColumns("Иванова – Петрова Мария"), { name: "Иванова – Петрова Мария", extra: null });
  // Хвост с цифрами или со строчной буквы — это всё-таки второй столбец.
  assert.deepEqual(splitColumns("Иванов Иван - не помню"), { name: "Иванов Иван", extra: "не помню" });
  assert.deepEqual(splitColumns("Иванов Иван - 07.03"), { name: "Иванов Иван", extra: "07.03" });
});

test("planPeopleImport: двойная фамилия целиком, а не полфамилии в базу", () => {
  const plan = planPeopleImport("Римский - Корсаков Пётр\nИванова - Петрова Мария 07.03.2006");
  assert.deepEqual(
    plan.people.map((p) => [p.fullName, p.birthday]),
    [
      ["Римский - Корсаков Пётр", null],
      ["Иванова - Петрова Мария", "2006-03-07"],
    ],
  );
  assert.equal(plan.counts.add, 2);
});

test("looksLikeHeading: шапка списка — да, фамилия с тем же началом — нет", () => {
  assert.ok(looksLikeHeading("Список группы"));
  assert.ok(looksLikeHeading("ФИО"));
  assert.ok(looksLikeHeading("Староста"));
  assert.ok(looksLikeHeading("Дата рождения"));
  assert.ok(!looksLikeHeading("Иванов Иван"));
  assert.ok(!looksLikeHeading("Курсов Иван"));
  assert.ok(!looksLikeHeading("Старостина Анна"));
  assert.ok(!looksLikeHeading("Людмила Иванова"));
});

test("planPeopleImport: строку-шапку помечаем, чтобы галочка не стояла по умолчанию", () => {
  const plan = planPeopleImport("Список группы\nФИО\tДата рождения\nИванов Иван");
  assert.deepEqual(
    plan.people.map((p) => [p.fullName, p.looksLikeHeading]),
    [
      ["Список группы", true],
      ["ФИО", true],
      ["Иванов Иван", false],
    ],
  );
});

test("planPeopleImport: человек из архива считается отдельно от тех, кто в группе", () => {
  const plan = planPeopleImport("Иванов Иван\nПетров Пётр", [
    { id: "u-1", fullName: "Иванов Иван", status: "removed" },
    { id: "u-2", fullName: "Петров Пётр", status: "active" },
  ]);
  assert.equal(plan.counts.archived, 1);
  assert.equal(plan.counts.exists, 1);
  assert.equal(plan.counts.add, 0);
  assert.equal(plan.people[0].existingStatus, "removed");
  assert.equal(plan.people[0].existingId, "u-1");
  assert.equal(plan.people[1].existingStatus, "active");
});

test("parseBirthday: три формата и мусор", () => {
  assert.deepEqual(parseBirthday("07.03.2006"), { birthday: "2006-03-07", note: "ok" });
  assert.deepEqual(parseBirthday("7.3.2006"), { birthday: "2006-03-07", note: "ok" });
  assert.deepEqual(parseBirthday("2006-03-07"), { birthday: "2006-03-07", note: "ok" });
  assert.deepEqual(parseBirthday("07.03"), { birthday: "2000-03-07", note: "no-year" });
  assert.deepEqual(parseBirthday("29.02"), { birthday: "2000-02-29", note: "no-year" });
  assert.deepEqual(parseBirthday(""), { birthday: null, note: "none" });
  assert.deepEqual(parseBirthday(null), { birthday: null, note: "none" });
  assert.deepEqual(parseBirthday("31.02.2006"), { birthday: null, note: "bad" });
  assert.deepEqual(parseBirthday("33.13.2006"), { birthday: null, note: "bad" });
  assert.deepEqual(parseBirthday("не помню"), { birthday: null, note: "bad" });
});

test("planPeopleImport: нумерованный список с ДР, дублями и мусором", () => {
  const plan = planPeopleImport(
    [
      "Список группы",
      "1. Иванов Иван Иванович — 07.03.2006",
      "2) Семёнова  Алёна\t14.09",
      "3. Иванов иван иванович",
      "4. петров пётр 2005-12-01",
      "",
      "5. Сидоров Сидор — не помню",
      "https://vk.com/im",
      "===",
      "21",
    ].join("\n"),
    [{ fullName: "Петров Пётр" }],
  );

  assert.deepEqual(
    plan.people.map((p) => [p.fullName, p.status, p.birthday, p.birthdayNote]),
    [
      ["Список группы", "new", null, "none"],
      ["Иванов Иван Иванович", "new", "2006-03-07", "ok"],
      ["Семёнова Алёна", "new", "2000-09-14", "no-year"],
      ["Иванов иван иванович", "dupe", null, "none"],
      ["петров пётр", "exists", "2005-12-01", "ok"],
      ["Сидоров Сидор", "new", null, "bad"],
    ],
  );
  assert.equal(plan.people[4].existingName, "Петров Пётр");
  assert.deepEqual(
    plan.issues.map((i) => i.raw),
    ["https://vk.com/im", "===", "21"],
  );
  assert.deepEqual(plan.counts, { parsed: 6, add: 4, exists: 1, archived: 0, dupe: 1, issues: 3 });
  assert.ok(plan.people[0].looksLikeHeading, "«Список группы» помечено как шапка списка");
});

test("planPeopleImport: ё и регистр не заводят второго такого же человека", () => {
  const plan = planPeopleImport("СЕМЕНОВА  АЛЕНА", [{ fullName: "Семёнова Алёна" }]);
  assert.equal(plan.counts.add, 0);
  assert.equal(plan.people[0].status, "exists");
  assert.equal(plan.people[0].existingName, "Семёнова Алёна");
});

test("planPeopleImport: пустой текст — ничего и без ошибок", () => {
  assert.deepEqual(planPeopleImport("   \n\n  ").counts, { parsed: 0, add: 0, exists: 0, archived: 0, dupe: 0, issues: 0 });
});

test("planPeopleImport: одна фамилия без имени тоже человек", () => {
  const plan = planPeopleImport("- Иванов");
  assert.equal(plan.counts.add, 1);
  assert.equal(plan.people[0].fullName, "Иванов");
});

test("planPeopleImport: длинную фразу в имена не берём", () => {
  const plan = planPeopleImport("Ребята кто не сдал допуск пишите старосте пожалуйста");
  assert.equal(plan.counts.add, 0);
  assert.equal(plan.issues[0].reason, "слишком длинная строка");
});
