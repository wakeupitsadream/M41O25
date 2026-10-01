// Навигация без сторожа (снят после переезда на Next 16, см. docs/ROADMAP.md, «Проблема P0»): форма с ошибкой
// валидации не перезагружает страницу и показывает ошибку на месте; обычный переход по ссылке проходит клиентской
// навигацией, без перезагрузки и за разумное время. Само зависание воспроизводит e2e/nav-hang.mjs.
import assert from "node:assert/strict";
import { launch, login, BASE, PIN, assertNoReloads } from "./lib.mjs";

/** Порог перехода: раннер CI медленный, но зависание — это десятки секунд или навсегда, а не единицы. */
const NAV_LIMIT_MS = 6000;

const { browser, page } = await launch();
await login(page);
await page.goto(`${BASE}/me`, { waitUntil: "networkidle" });
// Метка в window переживает только клиентскую навигацию: полная перезагрузка её стирает.
await page.evaluate(() => { window.__probeMarker = 1; });
// Ошибка валидации, а не неверный текущий PIN: тот считается серией неудач и после пяти прогонов подряд
// закрыл бы админу вход (lib/auth.ts, registerPinFailure).
await page.fill('input[name="current"]', PIN);
await page.fill('input[name="pin"]', "1111");
await page.fill('input[name="pin2"]', "2222");
await page.locator('input[name="pin2"]').press("Enter");
// Не просто [role="alert"]: Next держит на странице пустой announcer маршрута с той же ролью, он матчился бы первым.
const alert = page.locator('form:has(input[name="current"]) [role="alert"]').first();
await alert.waitFor({ timeout: 15000 });
const alertText = await alert.textContent();
// Пауза после ответа: отложенная перезагрузка (так работал сторож) должна была бы случиться именно здесь.
await page.waitForTimeout(1500);
const marker = await page.evaluate(() => window.__probeMarker);
console.log("alert:", alertText, "| marker after form:", marker);
assert.equal(marker, 1, "страница перезагрузилась после отправки формы с ошибкой");
assert.ok(alertText && alertText.trim(), "ошибка формы не показана");
// Переход по ссылке на маленькую страницу: клиентская навигация, без перезагрузки, укладывается в порог.
const t0 = Date.now();
await page.click('a[href="/group"]');
await page.waitForURL("**/group", { timeout: NAV_LIMIT_MS });
const dt = Date.now() - t0;
const markerAfterNav = await page.evaluate(() => window.__probeMarker);
console.log("nav /me -> /group:", dt, "ms | marker after nav:", markerAfterNav);
assert.ok(dt < NAV_LIMIT_MS, `переход /me → /group шёл ${dt} мс`);
assert.equal(markerAfterNav, 1, "переход /me → /group прошёл полной перезагрузкой, а не клиентской навигацией");
assertNoReloads();
await browser.close();
console.log("probe OK");
