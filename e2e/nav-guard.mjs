// Сторож навигации (components/features/nav-guard.tsx) не должен срабатывать ложно: форма с ошибкой валидации
// не перезагружает страницу, обычный переход не задерживается. Само зависание воспроизводит e2e/nav-hang.mjs.
import assert from "node:assert/strict";
import { launch, login, BASE } from "./lib.mjs";
const { browser, page } = await launch();
const warns = [];
page.on("console", (m) => { if (m.type() === "warning" && m.text().includes("[raspison]")) warns.push(m.text()); });
await login(page);
await page.goto(`${BASE}/me`, { waitUntil: "networkidle" });
await page.evaluate(() => { window.__probeMarker = 1; });
await page.fill('input[name="current"]', "9999");
await page.fill('input[name="pin"]', "1234");
await page.fill('input[name="pin2"]', "1234");
await page.locator('input[name="pin2"]').press("Enter");
await page.waitForTimeout(5500);
const marker = await page.evaluate(() => window.__probeMarker);
const alertText = await page.locator('[role="alert"]').first().textContent().catch(() => null);
console.log("marker after 5.5s:", marker, "| alert:", alertText, "| watchdog warns:", warns.length);
assert.equal(marker, 1, "страница перезагрузилась — ложное срабатывание сторожа");
assert.ok(alertText, "ошибка формы не показана");
assert.equal(warns.length, 0, "сторож сработал на обычную форму");
// Успешный переход по ссылке на маленькую страницу: без задержки в 2,5 с.
const t0 = Date.now();
await page.click('a[href="/group"]');
await page.waitForURL("**/group", { timeout: 8000 });
const dt = Date.now() - t0;
console.log("nav /me -> /group:", dt, "ms | warns:", warns.length);
assert.ok(dt < 2000, "переход шёл дольше 2 с — похоже, сработал сторож");
assert.equal(warns.length, 0);
await browser.close();
console.log("probe OK");
