// Общие помощники для скриптов проверки: запуск Chromium как iPhone и вход под админом.
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";

export const BASE = process.env.BASE ?? "http://localhost:3000";
export const OUT = process.env.OUT ?? "/tmp/claude-0/-home-user-M41O25/16f31fc5-fb28-52e5-aa2e-7ada5db9c855/scratchpad/shots";
export const INVITE = process.env.INVITE ?? "M41-2025";
export const PIN = process.env.PIN ?? "1234";
export const WHO = process.env.WHO ?? "Батутин Максим";

export async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" });
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
