// Общие помощники для скриптов проверки: запуск Chromium как iPhone и вход под админом.
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.BASE ?? "http://localhost:3000";
export const OUT = process.env.OUT ?? path.join(process.cwd(), "e2e/shots");
/** Сегодня в часовом поясе группы (не UTC — иначе после 19:00 UTC дата уезжает на завтра). */
export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg" }).format(new Date());
export const INVITE = process.env.INVITE ?? "M41-2025";
export const PIN = process.env.PIN ?? "1234";
export const WHO = process.env.WHO ?? "Батутин Максим";

export async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  // PW_CHROMIUM — путь к системному Chromium (в песочнице разработки); без него Playwright берёт свой браузер (npx playwright install chromium).
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await browser.newContext({
    ...devices["iPhone 15"],
    deviceScaleFactor: 2,
    colorScheme: "dark",
    locale: "ru-RU",
    timezoneId: "Asia/Yekaterinburg",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon") && !m.text().includes("404")) console.log("CONSOLE:", m.text());
  });
  const shot = async (name) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log("shot", name, page.url());
  };
  return { browser, ctx, page, shot };
}

/** Вход: код → выбор → PIN (задаёт PIN, если профиль ещё не занят). */
export async function login(page, { who = WHO, pin = PIN } = {}) {
  await page.goto(`${BASE}/enter`, { waitUntil: "networkidle" });
  if (page.url().includes("/s")) return;
  await page.fill('input[name="code"]', INVITE);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/enter/who", { timeout: 20000 });
  await page.click(`a:has-text("${who}")`);
  await page.waitForURL("**/enter/pin**", { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  const pin2 = await page.$('input[name="pin2"]');
  await page.fill('input[name="pin"]', pin);
  if (pin2) await page.fill('input[name="pin2"]', pin);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/s**", { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}

/** STRICT_NAV=1 (CI): перезагрузка страницы в waitOrReload — падение скрипта, а не строка в логе. */
const STRICT_NAV = process.env.STRICT_NAV === "1";
/** Сколько раз за прогон экран не обновился сам и waitOrReload перезагружал страницу. В норме 0. */
let reloads = 0;

/**
 * Ждём появления locator; если за timeout не появился — перезагружаем страницу и ждём ещё раз.
 * Раньше это был обход P0 (docs/ROADMAP.md): после server action обновление экрана могло зависнуть при уже
 * сохранённых данных. Сторож навигации снят, и теперь перезагрузка — не норма, а симптом регрессии: считаем их,
 * пишем в лог, а при STRICT_NAV=1 роняем скрипт сразу, чтобы зависание не прошло CI зелёным.
 */
export async function waitOrReload(page, locator, timeout = 8000) {
  const first = await locator.first().waitFor({ timeout }).then(() => true).catch(() => false);
  if (first) return true;
  reloads++;
  const where = page.url();
  console.log(`waitOrReload: экран не обновился за ${timeout} мс на ${where}, перезагружаем страницу (перезагрузок за прогон: ${reloads})`);
  if (STRICT_NAV) throw new Error(`STRICT_NAV: экран не обновился за ${timeout} мс на ${where} — обновление после server action зависло`);
  await page.reload({ waitUntil: "networkidle" });
  return locator.first().waitFor({ timeout }).then(() => true).catch(() => false);
}

/** Сколько раз за прогон waitOrReload перезагружал страницу. */
export const reloadCount = () => reloads;

/** В конце скрипта: при STRICT_NAV=1 любая перезагрузка — падение, без него — только строка в логе. */
export function assertNoReloads() {
  if (reloads === 0) return;
  const msg = `перезагрузок страницы за прогон: ${reloads} — обновление экрана после server action зависало`;
  if (STRICT_NAV) throw new Error(`STRICT_NAV: ${msg}`);
  console.log(`waitOrReload: ${msg}`);
}

process.on("exit", () => {
  if (reloads > 0) console.log(`waitOrReload: итого перезагрузок за прогон: ${reloads}`);
});
