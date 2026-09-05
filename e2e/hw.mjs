// Прогон домашки: пустой список → быстрая форма → создание → карточка → дополнение → комментарий → список.
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import { BASE, OUT, launch, login, waitOrReload } from "./lib.mjs";

const { browser, page, shot } = await launch();
await login(page);

await page.goto(`${BASE}/hw`, { waitUntil: "networkidle" });
await shot("30-hw-list");

await page.goto(`${BASE}/hw/new`, { waitUntil: "networkidle" });
await shot("31-hw-new");
await page.fill("textarea", "№ 214–220, стр. 48. Сдать письменно, проверка на паре.");
await page.getByRole("button", { name: "Подробнее" }).click();
await page.waitForTimeout(400);

// Загружаем картинку-вложение (генерируем PNG на лету через canvas в браузере)
const pngPath = path.join(OUT, "test-upload.png");
const dataUrl = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 480;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1c1c24";
  ctx.fillRect(0, 0, 640, 480);
  ctx.fillStyle = "#C8FF2E";
  ctx.font = "bold 48px sans-serif";
  ctx.fillText("Фото доски", 40, 240);
  return c.toDataURL("image/png");
});
fs.writeFileSync(pngPath, Buffer.from(dataUrl.split(",")[1], "base64"));
await page.setInputFiles('input[type="file"]', pngPath);
await page.waitForSelector('img[alt^="test-upload"]', { timeout: 20000 });
await shot("32-hw-new-more");

await page.getByRole("button", { name: /Отправить/ }).click();
await page.waitForURL(/\/hw\/[0-9a-f-]{36}$/, { timeout: 30000 });
await page.waitForLoadState("networkidle");
await shot("33-hw-detail");
assert.ok((await page.locator("img[alt^=\"test-upload\"]").count()) >= 1, "вложение не показано в карточке");

await page.getByRole("button", { name: /Дополнить/ }).click();
await page.waitForTimeout(400);
await page.fill('textarea[placeholder^="Ещё нужно"]', "И ещё принести распечатку таблицы 3.");
await page.getByRole("button", { name: "Добавить" }).click();
await page.waitForTimeout(1500);

await page.fill('textarea[placeholder^="«А точно"]', "А точно к пятнице? Вроде говорили про четверг");
await page.getByRole("button", { name: "Отправить" }).click();
await page.waitForTimeout(1500);
await shot("34-hw-detail-filled");

await page.goto(`${BASE}/hw`, { waitUntil: "networkidle" });
await shot("35-hw-list-filled");

// Второе ДЗ по тому же предмету → отметка «дубль»
await page.goto(`${BASE}/hw/new`, { waitUntil: "networkidle" });
await page.fill("textarea", "номера 214-220 письменно");
await page.getByRole("button", { name: /Отправить/ }).click();
await page.waitForURL(/\/hw\/[0-9a-f-]{36}$/, { timeout: 30000 });
await page.waitForLoadState("networkidle");
const dupBtn = page.getByRole("button", { name: /Это дубль/ });
console.log("dup button visible:", await dupBtn.count());
assert.equal(await dupBtn.count(), 1, "кнопка «Это дубль» не показана для похожей записи");
if (await dupBtn.count()) {
  await dupBtn.click();
  await page.waitForTimeout(400);
  await page.locator("li button").first().click();
  // До 10 с: при зависшем переходе сторож навигации восстанавливает страницу через ~3 с.
  await waitOrReload(page, page.locator("text=/дубл/i"));
  await shot("36-hw-dup");
  assert.ok((await page.locator("text=/дубл/i").count()) >= 1, "после отметки нет признака дубля");
}

await page.goto(`${BASE}/me`, { waitUntil: "networkidle" });
await shot("37-me");

await browser.close();
