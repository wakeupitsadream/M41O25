import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SLOT_TIMES, evalMetrics, type EvalMetrics, type ExpectedFixture } from "../lib/ocr/eval";
import type { OcrResult } from "../lib/ocr/schema";

/**
 * Прогон фикстур распознавания: fixtures/ocr/<name>[.N].{jpg,jpeg,png,webp} + <name>.expected.json → precision/recall
 * по ключу (день, пара, нормализованный предмет), латентность, попытки, токены. Формат — fixtures/ocr/README.md.
 *
 *   npm run ocr:eval                 — реальный ключ из .env.local (OCR_MOCK не должен быть 1)
 *   npm run ocr:eval -- --strong     — сильная модель (OCR_MODEL_STRONG)
 *   npm run ocr:eval -- --mock       — вместо Polza тестовый ответ; без фикстур берётся встроенный пример
 *   npm run ocr:eval -- --dir path   — другая папка с фикстурами
 *   npm run ocr:eval -- --verbose    — печатать пропущенные и лишние пары
 *
 * Запускается через `node --import tsx --conditions=react-server`: lib/ocr/recognize.ts помечен `server-only`.
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const MOCK = flag("--mock");
const STRONG = flag("--strong");
const VERBOSE = flag("--verbose");
const DIR = path.resolve(opt("--dir") ?? "fixtures/ocr");

const die = (msg: string): never => {
  console.error(`[ocr-eval] ${msg}`);
  process.exit(1);
};

if (!MOCK) {
  if (process.env.OCR_MOCK === "1") die("OCR_MOCK=1 — прогон пойдёт по тестовому ответу, а не по Polza. Убери переменную из .env.local или запусти с --mock, если это и нужно.");
  if (!process.env.POLZA_API_KEY) die("POLZA_API_KEY не задан в .env.local — без ключа считать нечего (для проверки скрипта есть --mock).");
}

type Fixture = { name: string; images: string[]; expected: ExpectedFixture };

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** `sat1.jpg`, `sat1.1.jpg`, `sat1-2.png` → фикстура `sat1`; несколько файлов — части одного документа в порядке номера. */
function collectFixtures(dir: string): Fixture[] {
  if (!fs.existsSync(dir)) return [];
  const byName = new Map<string, string[]>();
  for (const f of fs.readdirSync(dir).filter((f) => IMAGE_RE.test(f)).sort()) {
    const base = f.replace(IMAGE_RE, "").replace(/[.-]\d+$/, "");
    byName.set(base, [...(byName.get(base) ?? []), path.join(dir, f)]);
  }
  const out: Fixture[] = [];
  for (const [name, images] of byName) {
    const expectedPath = path.join(dir, `${name}.expected.json`);
    if (!fs.existsSync(expectedPath)) {
      console.warn(`[ocr-eval] ${name}: нет ${path.basename(expectedPath)} — пропускаю`);
      continue;
    }
    let expected: ExpectedFixture;
    try {
      expected = JSON.parse(fs.readFileSync(expectedPath, "utf8")) as ExpectedFixture;
    } catch (e) {
      console.warn(`[ocr-eval] ${name}: не разобрать expected.json (${e instanceof Error ? e.message : e}) — пропускаю`);
      continue;
    }
    if (!Array.isArray(expected.lessons)) {
      console.warn(`[ocr-eval] ${name}: в expected.json нет массива lessons — пропускаю`);
      continue;
    }
    out.push({ name, images, expected });
  }
  return out;
}

const toDataUrl = (file: string) => `data:${MIME[path.extname(file).toLowerCase()] ?? "image/jpeg"};base64,${fs.readFileSync(file).toString("base64")}`;

/** Встроенный пример для --mock без фикстур: ожидание отличается от тестового ответа одной пропущенной и одной лишней парой. */
function builtinCase(mock: OcrResult): Fixture {
  const lessons = mock.lessons.map((l) => ({ day: l.day, slot: l.slot, subject: l.subject, weekType: l.week_type }));
  lessons.splice(2, 1); // модель «нашла» пару, которой в ожидании нет → precision < 1
  lessons.push({ day: "sat", slot: 2, subject: "Философия", weekType: "both" }); // ожидаемая пара, которую модель не нашла → recall < 1
  return { name: "builtin-mock", images: [], expected: { group: mock.group_label_seen ?? "М41О25", weekType: mock.week_type, lessons } };
}

type Row = { name: string; model: string; attempts: number; ms: number; tokens: string; m: EvalMetrics | null; error?: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pad = (s: string, n: number, right = false) => (right ? s.padStart(n) : s.padEnd(n));

async function main() {
  const { recognizeSchedule, mockOcrResult } = await import("../lib/ocr/recognize");
  let fixtures = collectFixtures(DIR);
  if (!fixtures.length) {
    if (!MOCK) die(`В ${DIR} нет фикстур (нужны <name>.jpg + <name>.expected.json — см. fixtures/ocr/README.md).`);
    console.log(`[ocr-eval] в ${DIR} фикстур нет — беру встроенный пример`);
    fixtures = [builtinCase(mockOcrResult("М41О25"))];
  }
  console.log(`[ocr-eval] режим: ${MOCK ? "mock" : STRONG ? "сильная модель" : "основная модель"}, фикстур: ${fixtures.length}\n`);

  const rows: Row[] = [];
  for (const fx of fixtures) {
    const groupShort = fx.expected.group ?? "М41О25";
    const slotTimes = fx.expected.slotTimes ?? DEFAULT_SLOT_TIMES;
    const started = Date.now();
    try {
      const out = MOCK
        ? { result: mockOcrResult(groupShort), model: "mock", attempts: 1, usage: null, durationMs: Date.now() - started }
        : await recognizeSchedule({ images: fx.images.map((f) => ({ dataUrl: toDataUrl(f) })), groupShort, slotTimes, strong: STRONG });
      const m = evalMetrics(fx.expected, out.result);
      rows.push({ name: fx.name, model: out.model, attempts: out.attempts, ms: out.durationMs, tokens: out.usage ? `${out.usage.prompt}+${out.usage.completion}` : "—", m });
      if (!out.result.group_found) console.warn(`[ocr-eval] ${fx.name}: группа не найдена (group_label_seen=${out.result.group_label_seen})`);
      if (VERBOSE || m.missing.length + m.extra.length <= 6) {
        for (const k of m.missing) console.log(`  ${fx.name}  пропущено  ${k}`);
        for (const k of m.extra) console.log(`  ${fx.name}  лишнее     ${k}`);
      }
    } catch (e) {
      rows.push({ name: fx.name, model: "—", attempts: 0, ms: Date.now() - started, tokens: "—", m: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const head = [pad("фикстура", 16), pad("ожид.", 6, true), pad("найд.", 6, true), pad("совп.", 6, true), pad("precision", 10, true), pad("recall", 8, true), pad("F1", 6, true), pad("попыт.", 7, true), pad("время", 8, true), pad("токены", 12, true), "модель"].join(" ");
  console.log(`\n${head}\n${"-".repeat(head.length)}`);
  let exp = 0;
  let found = 0;
  let tp = 0;
  let ms = 0;
  for (const r of rows) {
    if (!r.m) {
      console.log(`${pad(r.name, 16)} ОШИБКА: ${r.error}`);
      continue;
    }
    exp += r.m.expected;
    found += r.m.found;
    tp += r.m.tp;
    ms += r.ms;
    console.log(
      [pad(r.name, 16), pad(String(r.m.expected), 6, true), pad(String(r.m.found), 6, true), pad(String(r.m.tp), 6, true), pad(pct(r.m.precision), 10, true), pad(pct(r.m.recall), 8, true), pad(pct(r.m.f1), 6, true), pad(String(r.attempts), 7, true), pad(`${(r.ms / 1000).toFixed(1)} с`, 8, true), pad(r.tokens, 12, true), r.model].join(" "),
    );
  }
  const okRows = rows.filter((r) => r.m).length;
  if (okRows) {
    const p = found ? tp / found : 1;
    const rc = exp ? tp / exp : 1;
    console.log("-".repeat(head.length));
    console.log([pad("итого", 16), pad(String(exp), 6, true), pad(String(found), 6, true), pad(String(tp), 6, true), pad(pct(p), 10, true), pad(pct(rc), 8, true), pad(pct(p + rc ? (2 * p * rc) / (p + rc) : 0), 6, true), pad("", 7), pad(`${(ms / 1000 / okRows).toFixed(1)} с/шт`, 8, true)].join(" "));
  }
  const failed = rows.filter((r) => !r.m).length;
  if (failed) {
    console.error(`\n[ocr-eval] не распознано фикстур: ${failed}`);
    process.exit(1);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
