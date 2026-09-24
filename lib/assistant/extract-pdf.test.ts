import { test } from "node:test";
import assert from "node:assert/strict";
import { fitRaw } from "./extract-fit";
import { meaningfulChars, pageRanges, pdfRaw, type PdfPage } from "./extract-pdf";

const TITLE = "Министерство науки и высшего образования\nКурсовая работа: макроэкономика\nОренбург 2026";

test("pdfRaw: набранный титул и 14 сканов — пометка со счётом и номерами страниц, «из M» — все страницы", () => {
  const pages: PdfPage[] = [{ n: 1, text: TITLE }, ...Array.from({ length: 14 }, (_, i) => ({ n: i + 2, text: "" }))];
  const r = fitRaw(pdfRaw(pages, 15, null), 30_000);
  assert.equal(r.text, `— Страница 1 —\n${TITLE}`);
  assert.equal(r.truncated, false);
  assert.equal(r.note, "страниц без текста (вероятно, сканы): 14 из 15 (стр. 2–15) — пришли их фото");
});

test("pdfRaw: скан с водяным знаком приложения на каждой странице — это скан, а не текст", () => {
  const pages = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, text: `Scanned with CamScanner` }));
  assert.deepEqual(fitRaw(pdfRaw(pages, 5, null), 30_000), { text: "", truncated: false, note: "в этом PDF нет текста — пришли страницы фото" });
  // Один лист с водяным знаком — повтора нет, но знак узнаётся по тексту.
  assert.equal(pdfRaw([{ n: 1, text: "Scanned with CamScanner" }], 1, null).kind, "none");
});

test("pdfRaw: колонтитулы и номера страниц не считаются текстом страницы", () => {
  const body = "Задача 1. Найти эластичность спроса по цене при P = 10 и Q = 200.";
  const pages: PdfPage[] = [
    { n: 1, text: `РАНХиГС, 2026\n${body}\n1` },
    { n: 2, text: "РАНХиГС, 2026\n- 2 -" },
    { n: 3, text: `РАНХиГС, 2026\n${body.replace("1", "2")}\nстр. 3` },
  ];
  assert.deepEqual(meaningfulChars(pages).map((n) => n > 10), [true, false, true]);
  const r = fitRaw(pdfRaw(pages, 3, null), 30_000);
  assert.equal(r.note, "страниц без текста (вероятно, сканы): 1 из 3 (стр. 2) — пришли их фото");
});

test("pdfRaw: прочитана часть — «из K прочитанных», обрезка — до последней просмотренной страницы", () => {
  const pages: PdfPage[] = Array.from({ length: 25 }, (_, i) => ({ n: i + 1, text: i % 2 === 0 ? `Текст страницы ${i + 1}: ${"слово ".repeat(20)}` : "" }));
  const r = fitRaw(pdfRaw(pages, 40, "budget"), 30_000);
  assert.equal(r.truncated, true);
  assert.equal(r.note, "документ обрезан, показаны первые 25 из 40 страниц; страниц без текста (вероятно, сканы): 12 из 25 прочитанных (стр. 2, 4, 6, 8, 10, 12, …) — пришли их фото");
});

test("pdfRaw: не успели — пометка; ничего не прочитали — «не успел прочитать»", () => {
  assert.deepEqual(pdfRaw([], 10, "time"), { kind: "none", note: "не успел прочитать файл — пришли его отдельным сообщением" });
  const r = fitRaw(pdfRaw([{ n: 1, text: TITLE }], 10, "time"), 30_000);
  assert.equal(r.note, "документ обрезан, показаны первые 1 из 10 страниц; не успел дочитать файл — прочитана только часть");
});

test("pageRanges: подряд идущие — диапазоном", () => {
  assert.equal(pageRanges([2, 3, 4, 7, 9, 10]), "2–4, 7, 9–10");
  assert.equal(pageRanges([5]), "5");
});
