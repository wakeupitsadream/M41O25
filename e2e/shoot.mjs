// Прогон входа + скриншоты экранов на вьюпорте iPhone 15 (393x852, dpr 3 → делаем 2 для веса)
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/claude-0/-home-user-M41O25/16f31fc5-fb28-52e5-aa2e-7ada5db9c855/scratchpad/shots";
const STEPS = (process.env.STEPS ?? "enter,who,pin,app").split(",");
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
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE:", m.text()));

const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name, page.url());
};

await page.goto(`${BASE}/enter`, { waitUntil: "networkidle" });
if (STEPS.includes("enter")) await shot("01-enter");
await page.fill('input[name="code"]', "m41-2025");
await page.click('button[type="submit"]');
await page.waitForURL("**/enter/who", { timeout: 20000 });
await page.waitForLoadState("networkidle");
if (STEPS.includes("who")) await shot("02-who");
await page.click('a:has-text("Батутин Максим")');
await page.waitForURL("**/enter/pin**", { timeout: 20000 });
await page.waitForLoadState("networkidle");
if (STEPS.includes("pin")) await shot("03-pin");
const pin2 = await page.$('input[name="pin2"]');
await page.fill('input[name="pin"]', "1234");
if (pin2) await page.fill('input[name="pin2"]', "1234");
await page.click('button[type="submit"]');
await page.waitForURL("**/s**", { timeout: 30000 });
await page.waitForLoadState("networkidle");
if (STEPS.includes("app")) {
  await shot("04-schedule");
  for (const [path, name] of [["/hw", "05-hw"], ["/group", "06-group"], ["/me", "07-me"]]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await shot(name);
  }
}
const extra = process.env.EXTRA ? JSON.parse(process.env.EXTRA) : [];
for (const [path, name] of extra) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await shot(name);
}
await browser.close();
