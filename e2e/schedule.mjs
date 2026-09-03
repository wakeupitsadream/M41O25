// Прогон расписания: неделя → день (погружение) → назад → семестр → неделя.
import assert from "node:assert/strict";
import { BASE, launch, login } from "./lib.mjs";

const { browser, page, shot } = await launch();
await login(page);

await page.goto(`${BASE}/s`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await shot("10-week");

const todayCard = page.locator('button:has-text("сегодня")').first();
const anyCard = page.locator("button[class*='rounded-lg'][class*='bg-surface']").first();
const card = (await todayCard.count()) ? todayCard : anyCard;
await card.click();
await page.waitForTimeout(700);
await shot("11-day");
console.log("day url:", page.url());
assert.match(page.url(), /\/s\/d\/\d{4}-\d{2}-\d{2}$/, "тап по дню не открыл экран дня");

await page.getByRole("button", { name: /Неделя/ }).first().click();
await page.waitForTimeout(700);
console.log("back url:", page.url());
assert.match(page.url(), /\/s(\/w\/\d{4}-\d{2}-\d{2})?$/, "«Неделя» не вернула на неделю");

await page.getByRole("button", { name: "Семестр" }).click();
await page.waitForTimeout(700);
await shot("12-semester");
console.log("semester url:", page.url());
assert.match(page.url(), /\/s\/semester$/, "экран семестра не открылся");

await page.getByRole("button", { name: "Закрыть" }).click();
await page.waitForTimeout(600);
console.log("closed url:", page.url());

// Прямой заход на URL дня (диплинк) и на чужую неделю
await page.goto(`${BASE}/s/w/2026-09-14`, { waitUntil: "networkidle" });
await shot("13-next-week");
await page.goto(`${BASE}/api/schedule`);
const json = await page.evaluate(() => document.body.innerText);
const payload = JSON.parse(json);
console.log("api weeks:", payload.weeks.length, "lessons:", payload.weeks.reduce((n, w) => n + w.lessons.length, 0));
assert.ok(payload.weeks.length >= 1, "/api/schedule без опубликованных недель");

await browser.close();
