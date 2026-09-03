// Прогон админки: обзор → недели → редактор (добавить пару, опубликовать) → люди → предметы → настройки.
import assert from "node:assert/strict";
import { BASE, launch, login } from "./lib.mjs";

const { browser, page, shot } = await launch();
await login(page);

await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
await shot("20-admin-home");

await page.goto(`${BASE}/admin/schedule`, { waitUntil: "networkidle" });
await shot("21-admin-weeks");

// Открываем черновик; если черновиков нет — создаём новую неделю формой
const draftLink = page.locator('a:has-text("черновик")').first();
if (await draftLink.count()) {
  await draftLink.click();
} else {
  await page.goto(`${BASE}/admin/schedule/new`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Создать" }).click();
}
await page.waitForURL(/\/admin\/schedule\/[0-9a-f-]{36}$/, { timeout: 20000 });
await page.waitForLoadState("networkidle");
await shot("22-admin-editor");

// Добавляем пару в первый свободный слот понедельника
const addBtn = page.locator('button:has-text("добавить")').first();
await addBtn.click();
await page.waitForTimeout(500);
await page.locator("select").nth(2).selectOption({ index: 1 }); // предмет из справочника
await page.waitForTimeout(200);
await shot("23-admin-lesson-sheet");
await page.getByRole("button", { name: "Сохранить" }).click();
await page.waitForTimeout(1500);
await shot("24-admin-editor-after-add");

// Публикуем
await page.getByRole("button", { name: /Опубликовать/ }).click();
// До 10 с: обычно бейдж появляется за секунду, но при зависшем refresh сторож перезагружает страницу через ~3 с.
await page.locator("text=опубликована").first().waitFor({ timeout: 10000 }).catch(() => {});
const status = await page.locator("text=опубликована").count();
console.log("published badge count:", status);
assert.ok(status >= 1, "неделя не опубликована");

await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
await shot("25-admin-users");
await page.locator('a[href^="/admin/users/"]').nth(1).click();
await page.waitForLoadState("networkidle");
await shot("26-admin-user-edit");

await page.goto(`${BASE}/admin/subjects`, { waitUntil: "networkidle" });
await shot("27-admin-subjects");
await page.goto(`${BASE}/admin/settings`, { waitUntil: "networkidle" });
await shot("28-admin-settings");
await page.goto(`${BASE}/admin/schedule/new`, { waitUntil: "networkidle" });
await shot("29-admin-new-week");

await browser.close();
