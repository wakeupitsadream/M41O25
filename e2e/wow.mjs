// Рулетка «кто отвечает» и PNG-карточка дня.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { BASE, OUT, launch, login, todayIso } from "./lib.mjs";

const { browser, page, shot } = await launch();
await login(page);
await page.goto(`${BASE}/group/roulette`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Крутить/ }).click();
await page.waitForSelector("text=Отвечает", { timeout: 15000 });
await page.waitForTimeout(600);
await shot("70-roulette");

const today = todayIso();
const res = await page.request.get(`${BASE}/api/share/day?date=${today}`);
console.log("share status:", res.status(), res.headers()["content-type"]);
const buf = await res.body();
fs.writeFileSync(path.join(OUT, "71-share-day.png"), buf);
console.log("share png bytes:", buf.length);
assert.equal(res.status(), 200, "карточка дня не отдалась");
assert.match(res.headers()["content-type"] ?? "", /image\/png/, "карточка дня не PNG");
assert.ok(buf.length > 10_000, "PNG подозрительно маленький");
await browser.close();
