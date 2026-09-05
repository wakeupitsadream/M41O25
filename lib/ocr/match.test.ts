import { test } from "node:test";
import assert from "node:assert/strict";
import { abbreviationMatches, aliasesToLearn, bigrams, diceSimilarity, hasSpelling, matchSubject, matchSubjectDetailed, normalizeTitle } from "./match";

const subjects = [
  { id: "m", name: "Математический анализ", shortName: null, aliases: [] },
  { id: "e", name: "Английский язык", shortName: null, aliases: [] },
  { id: "h", name: "История России", shortName: null, aliases: [] },
  { id: "mi", name: "Микроэкономика", shortName: null, aliases: [] },
  { id: "ma", name: "Макроэкономика", shortName: null, aliases: [] },
  { id: "p", name: "Правоведение", shortName: "Право", aliases: ["Основы права"] },
];

test("normalizeTitle и bigrams: ё→е, пунктуация — разделитель, биграммы не склеиваются через пробел", () => {
  assert.equal(normalizeTitle("Англ. яз. (практика)"), "англ яз практика");
  assert.equal(normalizeTitle("Зачёт"), "зачет");
  assert.deepEqual(bigrams("Англ. яз."), ["ан", "нг", "гл", "яз"]);
  assert.deepEqual(bigrams("а б"), ["а", "б"]);
});

test("diceSimilarity: опечатка близко к 1, разные слова — далеко", () => {
  assert.ok(diceSimilarity("Матиматический анализ", "Математический анализ") > 0.85);
  assert.ok(diceSimilarity("Информатика", "Информационные технологии") < 0.5);
  assert.equal(diceSimilarity("", "Что-то"), 0);
});

test("abbreviationMatches: сокращения по началам слов, но не двухбуквенные", () => {
  assert.equal(abbreviationMatches("Матан", "Математический анализ"), true);
  assert.equal(abbreviationMatches("Матем. анализ", "Математический анализ"), true);
  assert.equal(abbreviationMatches("Англ. яз.", "Английский язык"), true);
  assert.equal(abbreviationMatches("ИЯ", "История"), false);
  assert.equal(abbreviationMatches("Ист", "История"), false); // короче 4 букв
  assert.equal(abbreviationMatches("Анализ", "Математический анализ"), true);
  assert.equal(abbreviationMatches("Микроэконом.", "Макроэкономика"), false);
});

test("matchSubject: нечёткое — «Матан», «Англ. яз.», опечатка; «ИЯ» не цепляет «История»", () => {
  assert.deepEqual(matchSubjectDetailed("Матан", subjects), { id: "m", kind: "fuzzy" });
  assert.deepEqual(matchSubjectDetailed("Англ. яз.", subjects), { id: "e", kind: "fuzzy" });
  assert.equal(matchSubject("Матиматический анализ", subjects), "m");
  assert.equal(matchSubject("ИЯ", subjects), null);
  assert.equal(matchSubject("Ист.", subjects), null);
});

test("matchSubject: точное и по алиасу помечаются своим видом; двусмысленное нечёткое — null", () => {
  assert.deepEqual(matchSubjectDetailed("правоведение", subjects), { id: "p", kind: "exact" });
  assert.deepEqual(matchSubjectDetailed("Право", subjects), { id: "p", kind: "exact" });
  assert.deepEqual(matchSubjectDetailed("основы права", subjects), { id: "p", kind: "alias" });
  // Две экономики почти одинаковы по биграммам — без отрыва от второго кандидата не выбираем.
  assert.equal(matchSubject("Микроэконом.", subjects), "mi");
  assert.equal(matchSubject("экономика", subjects), null);
  assert.equal(matchSubject("", subjects), null);
});

test("aliasesToLearn: новые написания привязанных строк, без дублей и известных форм", () => {
  const learned = aliasesToLearn(
    [
      { subjectId: "m", title: "Матан" },
      { subjectId: "m", title: "МАТАН" },
      { subjectId: "m", title: "Математический анализ" },
      { subjectId: "p", title: "Основы права" },
      { subjectId: "p", title: "Право (лекция)" },
      { subjectId: null, title: "Физкультура" },
    ],
    subjects,
  );
  assert.deepEqual(
    [...learned.entries()],
    [
      ["m", ["Матан"]],
      ["p", ["Право (лекция)"]],
    ],
  );
  assert.equal(hasSpelling(subjects[5], "ПРАВО"), true);
  assert.equal(hasSpelling(subjects[5], "Правоведение (сем.)"), false);
});

test("aliasesToLearn: потолок 20 алиасов на предмет", () => {
  const full = { id: "x", name: "X", shortName: null, aliases: Array.from({ length: 19 }, (_, i) => `a${i}`) };
  const learned = aliasesToLearn([{ subjectId: "x", title: "новое" }, { subjectId: "x", title: "ещё" }], [full]);
  assert.deepEqual(learned.get("x"), ["новое"]);
});
