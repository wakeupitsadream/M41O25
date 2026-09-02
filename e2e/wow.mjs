// Рулетка «кто отвечает» и PNG-карточка дня.
import fs from "node:fs";
import path from "node:path";
import { BASE, OUT, launch, login } from "./lib.mjs";

const { browser, page, shot } = await launch();
await login(page);
await page.goto(`${BASE}/group/roulette`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Крутить/ }).click();
await page.waitForSelector("text=Отвечает", { timeout: 15000 });
await page.waitForTimeout(600);
await shot("70-roulette");

const today = new Date().toISOString().slice(0, 10);
const res = await page.request.get(`${BASE}/api/share/day?date=${today}`);
console.log("share status:", res.status(), res.headers()["content-type"]);
const buf = await res.body();
fs.writeFileSync(path.join(OUT, "71-share-day.png"), buf);
console.log("share png bytes:", buf.length);
await browser.close();
