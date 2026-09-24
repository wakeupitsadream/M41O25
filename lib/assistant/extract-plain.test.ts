import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeText } from "./extract-plain";

const TEXT = "Привет, конспект по макроэкономике: спрос и предложение.";

test("decodeText: UTF-8 с BOM и без, UTF-16LE и UTF-16BE с BOM", () => {
  assert.equal(decodeText(Buffer.from(TEXT, "utf8")), TEXT);
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TEXT, "utf8")])), TEXT);
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TEXT, "utf16le")])), TEXT);
  const be = Buffer.from(TEXT, "utf16le").swap16();
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), TEXT);
});

test("decodeText: UTF-16LE без BOM (латиница и цифры дают нули через байт)", () => {
  const s = "Lecture 5: GDP = C + I + G + NX, 2026";
  assert.equal(decodeText(Buffer.from(s, "utf16le")), s);
});

test("decodeText: один битый байт в UTF-8 не превращает кириллицу в кракозябры", () => {
  const body = Buffer.concat([Buffer.from(TEXT.repeat(5), "utf8"), Buffer.from([0xff])]);
  const out = decodeText(body);
  assert.ok(out.startsWith(TEXT));
  assert.ok(out.endsWith("�"));
  // Короткий файл: один битый из ~50 — это 2 %, но всё равно UTF-8.
  assert.equal(decodeText(Buffer.concat([Buffer.from(TEXT, "utf8"), Buffer.from([0xd0])])), `${TEXT}�`);
  // А много битых (больше 1 %) — уже не UTF-8.
  const noisy = Buffer.concat(Array.from({ length: 20 }, () => Buffer.concat([Buffer.from(TEXT, "utf8"), Buffer.from([0xff])])));
  assert.ok(!decodeText(noisy).startsWith(TEXT));
});

test("decodeText: Windows-1251 — и сплошной, и одна русская фраза в латинице", () => {
  const cp1251 = (s: string) => Buffer.from([...s].map(cp1251Byte));
  assert.equal(decodeText(cp1251(TEXT)), TEXT);
  const mixed = `${"x = 1; y = 2; // code ".repeat(400)}Привет`;
  assert.equal(decodeText(cp1251(mixed)), mixed);
});

/** Кодировщик Windows-1251 для теста: ASCII как есть, А–я — 0xC0–0xFF, ё/Ё — 0xB8/0xA8. */
function cp1251Byte(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c < 0x80) return c;
  if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
  if (c === 0x451) return 0xb8;
  if (c === 0x401) return 0xa8;
  throw new Error(`нет в тестовой таблице: ${ch}`);
}
