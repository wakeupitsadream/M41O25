import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, parseSettingsForm, withDefaults } from "./settings";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const VALID = { enabled: "on", priceRub: "200", dailyLimit: "15", weeklyLimit: "50", strongWeeklyLimit: "4", trialDays: "7", paymentNote: "СБП +7 900 000-00-00" };

test("withDefaults: пустой jsonb и null дают умолчания §1", () => {
  assert.deepEqual(withDefaults({}), DEFAULT_SETTINGS);
  assert.deepEqual(withDefaults(null), DEFAULT_SETTINGS);
  assert.deepEqual(withDefaults(undefined), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.enabled, false);
  assert.equal(DEFAULT_SETTINGS.priceRub, 200);
  assert.equal(DEFAULT_SETTINGS.dailyLimit, 15);
  assert.equal(DEFAULT_SETTINGS.weeklyLimit, 50);
  assert.equal(DEFAULT_SETTINGS.strongWeeklyLimit, 4);
  assert.equal(DEFAULT_SETTINGS.trialDays, 7);
  assert.equal(DEFAULT_SETTINGS.paymentNote, "");
});

test("withDefaults: частичный объект дополняется, не затирая заданное", () => {
  const s = withDefaults({ enabled: true, priceRub: 250 });
  assert.equal(s.enabled, true);
  assert.equal(s.priceRub, 250);
  assert.equal(s.dailyLimit, 15);
  assert.equal(s.paymentNote, "");
});

test("withDefaults: испорченное поле откатывается к своему умолчанию, остальные живут", () => {
  const s = withDefaults({ priceRub: -5, dailyLimit: "много" as unknown as number, trialDays: 3, paymentNote: 42 as unknown as string });
  assert.equal(s.priceRub, 200);
  assert.equal(s.dailyLimit, 15);
  assert.equal(s.trialDays, 3);
  assert.equal(s.paymentNote, "");
});

test("withDefaults: не возвращает тот же объект умолчаний (его нельзя случайно изменить)", () => {
  const s = withDefaults({});
  assert.notEqual(s, DEFAULT_SETTINGS);
});

test("parseSettingsForm: корректная форма → полные настройки", () => {
  const r = parseSettingsForm(form(VALID));
  assert.ok(r.ok);
  assert.deepEqual(r.settings, { enabled: true, priceRub: 200, dailyLimit: 15, weeklyLimit: 50, strongWeeklyLimit: 4, trialDays: 7, paymentNote: "СБП +7 900 000-00-00" });
});

test("parseSettingsForm: тумблер — «on»/«true»/«1», отсутствие поля — выключен", () => {
  const { enabled: _omit, ...rest } = VALID;
  void _omit;
  const off = parseSettingsForm(form(rest));
  assert.ok(off.ok && off.settings.enabled === false);
  for (const v of ["on", "true", "1"]) {
    const r = parseSettingsForm(form({ ...VALID, enabled: v }));
    assert.ok(r.ok && r.settings.enabled === true, v);
  }
  const falsy = parseSettingsForm(form({ ...VALID, enabled: "false" }));
  assert.ok(falsy.ok && falsy.settings.enabled === false);
});

test("parseSettingsForm: цена 0–5000, ноль допустим (бесплатно для своих)", () => {
  assert.ok(parseSettingsForm(form({ ...VALID, priceRub: "0" })).ok);
  assert.ok(parseSettingsForm(form({ ...VALID, priceRub: "5000" })).ok);
  const r = parseSettingsForm(form({ ...VALID, priceRub: "5001" }));
  assert.ok(!r.ok && /Цена/.test(r.error));
  const neg = parseSettingsForm(form({ ...VALID, priceRub: "-1" }));
  assert.ok(!neg.ok && /Цена/.test(neg.error));
  const frac = parseSettingsForm(form({ ...VALID, priceRub: "199.5" }));
  assert.ok(!frac.ok && /Цена/.test(frac.error));
});

test("parseSettingsForm: лимиты 1–200, пустое поле — ошибка про это поле, а не ноль", () => {
  const zero = parseSettingsForm(form({ ...VALID, dailyLimit: "0" }));
  assert.ok(!zero.ok && /в день/.test(zero.error));
  const big = parseSettingsForm(form({ ...VALID, weeklyLimit: "201" }));
  assert.ok(!big.ok && /в неделю/.test(big.error));
  const empty = parseSettingsForm(form({ ...VALID, strongWeeklyLimit: "" }));
  assert.ok(!empty.ok && /Сильных/.test(empty.error));
  const junk = parseSettingsForm(form({ ...VALID, dailyLimit: "пятнадцать" }));
  assert.ok(!junk.ok && /в день/.test(junk.error));
});

test("parseSettingsForm: триал 0–30", () => {
  assert.ok(parseSettingsForm(form({ ...VALID, trialDays: "0" })).ok);
  assert.ok(parseSettingsForm(form({ ...VALID, trialDays: "30" })).ok);
  const r = parseSettingsForm(form({ ...VALID, trialDays: "31" }));
  assert.ok(!r.ok && /триала/.test(r.error));
});

test("parseSettingsForm: реквизиты ≤ 500 символов, пробелы по краям срезаются", () => {
  const ok = parseSettingsForm(form({ ...VALID, paymentNote: `  ${"x".repeat(500)}  ` }));
  assert.ok(ok.ok && ok.settings.paymentNote.length === 500);
  const r = parseSettingsForm(form({ ...VALID, paymentNote: "x".repeat(501) }));
  assert.ok(!r.ok && /Реквизиты/.test(r.error));
});

test("parseSettingsForm: неделя меньше дня и сильных больше недели — понятная ошибка", () => {
  const week = parseSettingsForm(form({ ...VALID, dailyLimit: "20", weeklyLimit: "10" }));
  assert.ok(!week.ok && /неделю не может быть меньше/.test(week.error));
  const strong = parseSettingsForm(form({ ...VALID, dailyLimit: "5", weeklyLimit: "10", strongWeeklyLimit: "11" }));
  assert.ok(!strong.ok && /Сильных в неделю не может быть больше/.test(strong.error));
});
