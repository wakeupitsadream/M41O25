import assert from "node:assert/strict";
import { test } from "node:test";
import { balancedTags, htmlToPlain, inlineToHtml, markdownToHtml, splitToHtmlMessages } from "./markdown.js";

test("inline: жирный, курсив, код, ссылки, экранирование", () => {
  assert.equal(inlineToHtml("**Ответ:** 42"), "<b>Ответ:</b> 42");
  assert.equal(inlineToHtml("это *важно* и _тоже_"), "это <i>важно</i> и <i>тоже</i>");
  assert.equal(inlineToHtml("a < b && c > d"), "a &lt; b &amp;&amp; c &gt; d");
  assert.equal(inlineToHtml("`x < 1` и **жир**"), "<code>x &lt; 1</code> и <b>жир</b>");
  assert.equal(inlineToHtml("[сайт](https://example.com/a?b=1&c=2)"), '<a href="https://example.com/a?b=1&amp;c=2">сайт</a>');
  assert.equal(inlineToHtml("~~старое~~ новое"), "<s>старое</s> новое");
});

test("inline: математика не превращается в курсив", () => {
  assert.equal(inlineToHtml("2*3*4 = 24"), "2*3*4 = 24");
  assert.equal(inlineToHtml("a * b * c"), "a * b * c");
  assert.equal(inlineToHtml("snake_case_name"), "snake_case_name");
  assert.equal(inlineToHtml("x_1 + x_2"), "x_1 + x_2");
  assert.equal(inlineToHtml("5 * (3 + 2) * 2"), "5 * (3 + 2) * 2");
});

test("inline: перекрёстная разметка не ломает HTML", () => {
  const html = inlineToHtml("**a *b** c*");
  assert.equal(balancedTags(html), true);
});

test("блоки: заголовки, списки, цитаты, код, таблицы", () => {
  const md = [
    "### Решение",
    "1. Найдём **P**",
    "2. Подставим",
    "- пункт",
    "  - вложенный",
    "> цитата",
    "---",
    "```python",
    "print(a < b)",
    "```",
    "| Показатель | Значение |",
    "|---|---:|",
    "| TR | 100 |",
  ].join("\n");
  assert.equal(
    markdownToHtml(md),
    [
      "<b>Решение</b>",
      "1. Найдём <b>P</b>",
      "2. Подставим",
      "• пункт",
      "  • вложенный",
      "│ цитата",
      "———",
      "<pre>print(a &lt; b)</pre>",
      "<b>Показатель | Значение</b>",
      "TR | 100",
    ].join("\n"),
  );
});

test("незакрытый блок кода не роняет разметку", () => {
  assert.equal(markdownToHtml("```\ncode <x>"), "<pre>code &lt;x&gt;</pre>");
});

test("htmlToPlain снимает теги и экранирование", () => {
  assert.equal(htmlToPlain('<b>Ответ</b>: a &lt; b <a href="https://x.ru">x</a>'), "Ответ: a < b x (https://x.ru)");
});

test("split: короткий ответ — одно сообщение", () => {
  assert.deepEqual(splitToHtmlMessages("Привет, **мир**"), ["Привет, <b>мир</b>"]);
});

test("split: длинный ответ режется по абзацам, каждый кусок в лимите и с целыми тегами", () => {
  const para = (n: number) => `**Шаг ${n}.** ${"Текст шага с пояснением. ".repeat(20)}`;
  const md = Array.from({ length: 12 }, (_, i) => para(i + 1)).join("\n\n");
  const parts = splitToHtmlMessages(md, 1500);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.ok(p.length <= 1500, `len ${p.length}`);
    assert.equal(balancedTags(p), true);
  }
  assert.equal(parts.join("\n\n").match(/<b>Шаг/g)?.length, 12);
});

test("split: огромный блок кода делится с повтором ограды", () => {
  const code = Array.from({ length: 200 }, (_, i) => `line_${i} = ${i} * 2`).join("\n");
  const parts = splitToHtmlMessages("```\n" + code + "\n```", 1000);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.ok(p.startsWith("<pre>") && p.endsWith("</pre>"));
    assert.ok(p.length <= 1000);
  }
});

test("split: одна гигантская строка без пробелов всё равно режется", () => {
  const parts = splitToHtmlMessages("x".repeat(5000), 1000);
  assert.equal(parts.length, 5);
  assert.ok(parts.every((p) => p.length <= 1000));
});
