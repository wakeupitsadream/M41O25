// Офлайн-проверка на production-сборке (BASE=http://localhost:3001): вход → расписание → сеть выключена → перезагрузка.
import assert from "node:assert/strict";
import { BASE, launch, login } from "./lib.mjs";

const { browser, ctx, page, shot } = await launch();
await login(page);
await page.goto(`${BASE}/s`, { waitUntil: "networkidle" });
const swState = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const reg = await navigator.serviceWorker.ready;
  return reg.active?.state ?? "no-active";
});
console.log("service worker:", swState);
await page.waitForTimeout(1500);
const cacheKeys = await page.evaluate(async () => caches.keys());
console.log("caches:", cacheKeys);
const scheduleCached = await page.evaluate(async () => {
  for (const name of await caches.keys()) {
    const c = await caches.open(name);
    if (await c.match("/api/schedule")) return name;
  }
  return null;
});
console.log("schedule cached in:", scheduleCached);
assert.equal(swState, "activated", "service worker не активен (нужна production-сборка)");
assert.ok(scheduleCached, "/api/schedule не попал в кеш SW");

await ctx.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" }).catch((e) => console.log("reload error:", e.message));
await page.waitForTimeout(2500);
const cards = await page.locator("button:has-text('Понедельник')").count();
const offlinePill = await page.locator("text=Офлайн").count();
console.log("offline: day cards =", cards, "| offline pill =", offlinePill, "| url =", page.url());
await shot("60-offline-week");
assert.ok(cards >= 1, "офлайн: карточки дней не отрисованы из кеша");
assert.ok(offlinePill >= 1, "офлайн: плашка «Офлайн» не показана");
await page.locator("button:has-text('Понедельник')").first().click().catch(() => {});
await page.waitForTimeout(800);
await shot("61-offline-day");
await ctx.setOffline(false);
await browser.close();
