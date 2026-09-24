// Помощник по учёбе (docs/AI-CHAT.md §10): админ включает → студент берёт пробную неделю → вопрос со стримом
// и инструментом → сильный режим расходует оба счётчика → админ продлевает «+30 дней» → бейдж и выручка.
// Модель не вызывается: в CI и локально OCR_MOCK=1, стрим-роут отвечает заготовкой (lib/assistant/model.ts).
import assert from "node:assert/strict";
import { BASE, launch, login, waitOrReload } from "./lib.mjs";

const STUDENT = process.env.ASSISTANT_STUDENT ?? "Шестаков Илья";

const { browser, ctx, page, shot } = await launch();
// ConfirmButton спрашивает через window.confirm — соглашаемся.
page.on("dialog", (d) => d.accept());

/** «Сегодня: 2 из 15» → { used: 2, limit: 15 } из подписи полоски лимита. */
async function limit(label) {
  const aria = await page.locator(`[aria-label^="${label}: "]`).first().getAttribute("aria-label");
  const m = aria?.match(/(\d+) из (\d+)/);
  assert.ok(m, `нет полоски «${label}»`);
  return { used: Number(m[1]), limit: Number(m[2]) };
}

// 1. Админ включает помощника.
await login(page);
await page.goto(`${BASE}/admin/settings`, { waitUntil: "networkidle" });
const form = page.locator('form:has(textarea[name="paymentNote"])');
const toggle = form.getByRole("switch", { name: /Включён/ });
if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
await form.locator('textarea[name="paymentNote"]').fill("СБП +7 900 000-00-00, Т-Банк, Тест Т.");
await form.getByRole("button", { name: "Сохранить" }).click();
await waitOrReload(page, page.locator("text=Настройки помощника сохранены"));
await shot("80-assistant-settings");

// 2. Студент: плитка в хабе, пробная неделя.
await ctx.clearCookies();
await login(page, { who: STUDENT });
await page.goto(`${BASE}/group`, { waitUntil: "networkidle" });
assert.equal(await page.locator('a[href="/group/assistant"]').count(), 1, "плитки «Помощник» нет в хабе");
await page.goto(`${BASE}/group/assistant`, { waitUntil: "networkidle" });
const trialBtn = page.getByRole("button", { name: /Попробовать .* бесплатно/ });
if (await trialBtn.count()) {
  await trialBtn.click();
  await waitOrReload(page, page.locator("text=Пробная неделя"));
}
await shot("81-assistant-home");
const before = await limit("Сегодня");

// 3. Вопрос про расписание: стрим с инструментом, адрес беседы, таб-бара нет.
await page.getByRole("link", { name: /Новый чат/ }).click();
await page.waitForURL("**/group/assistant/new", { timeout: 20000 });
assert.equal(await page.locator('a[href="/hw/new"]').count(), 0, "таб-бар виден на экране чата");
await page.getByLabel("Сообщение помощнику").fill("Какие у нас пары завтра?");
await page.getByRole("button", { name: "Отправить" }).click();
await page.locator("text=Тестовый ответ помощника").first().waitFor({ timeout: 30000 });
await page.waitForURL(/\/group\/assistant\/[0-9a-f-]{36}$/, { timeout: 20000 });
// Ответ дописан до конца: кнопка «Стоп» исчезла, снова «Отправить».
await page.getByRole("button", { name: "Отправить" }).waitFor({ timeout: 30000 });
await shot("82-assistant-chat");

// 4. Сильный режим: расходует и дневной, и сильный счётчик.
const strong = page.getByRole("switch", { name: /Сильный режим/ });
await strong.click();
assert.equal(await strong.getAttribute("aria-checked"), "true", "сильный режим не включился");
await page.getByLabel("Сообщение помощнику").fill("Реши задачу посложнее");
await page.getByRole("button", { name: "Отправить" }).click();
await page.waitForFunction(() => document.body.innerText.split("Тестовый ответ помощника").length > 2, null, { timeout: 30000 });
await page.getByRole("button", { name: "Отправить" }).waitFor({ timeout: 30000 });
await shot("83-assistant-strong");

await page.goto(`${BASE}/group/assistant`, { waitUntil: "networkidle" });
const after = await limit("Сегодня");
const strongAfter = await limit("Сильных");
assert.equal(after.used, before.used + 2, `дневной счётчик: было ${before.used}, стало ${after.used}`);
assert.ok(strongAfter.used >= 1, "сильный ответ не списался");
assert.ok((await page.locator(`a[href^="/group/assistant/"]`).count()) >= 1, "беседа не появилась в списке");
await shot("84-assistant-limits");

// 5. Админ: «+30 дней» → бейдж в списке людей и выручка месяца.
await ctx.clearCookies();
await login(page);
await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
await page.locator(`a:has-text("${STUDENT}")`).first().click();
await page.waitForURL(/\/admin\/users\/[0-9a-f-]{36}$/, { timeout: 20000 });
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: /\+30 дней/ }).click();
await waitOrReload(page, page.locator("text=/оплачено до/"));
await shot("85-assistant-admin-user");
await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
assert.ok((await page.locator("text=/ИИ до/").count()) >= 1, "бейдж «ИИ до» не появился в списке людей");
await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
assert.ok((await page.locator("text=Помощник за месяц").count()) === 1, "нет карточки «Помощник за месяц»");
await shot("86-assistant-admin-month");

await browser.close();
console.log("assistant: ok");
