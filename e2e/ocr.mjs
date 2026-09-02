// Прогон OCR-пайплайна в тестовом режиме (OCR_MOCK=1): новая неделя → «По скану» → загрузка → распознать → применить.
import fs from "node:fs";
import path from "node:path";
import { BASE, OUT, launch, login } from "./lib.mjs";

const { browser, page, shot } = await launch();
await login(page);

await page.goto(`${BASE}/admin/schedule/new`, { waitUntil: "networkidle" });
// Берём дату далеко в будущем, чтобы неделя точно была новой
await page.fill('input[name="startsOn"]', "2026-11-16");
await page.selectOption('select[name="copyFrom"]', "");
await page.getByRole("button", { name: "Создать" }).click();
await page.waitForURL(/\/admin\/schedule\/[0-9a-f-]{36}$/, { timeout: 20000 });
await page.waitForLoadState("networkidle");

await page.getByRole("button", { name: /По скану/ }).click();
await page.waitForTimeout(500);
await shot("50-ocr-sheet");

const pngPath = path.join(OUT, "scan.png");
const dataUrl = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 1400; c.height = 1000;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1400, 1000);
  ctx.fillStyle = "#000"; ctx.font = "28px sans-serif";
  ctx.fillText("РАСПИСАНИЕ ЗАНЯТИЙ  М41О25  М41О26  М41О27", 60, 80);
  for (let i = 0; i < 12; i++) ctx.fillText(`${i + 1}. Матан  Иванова И.И.  214`, 60, 160 + i * 60);
  return c.toDataURL("image/png");
});
fs.writeFileSync(pngPath, Buffer.from(dataUrl.split(",")[1], "base64"));
await page.setInputFiles('input[type="file"]', pngPath);
await page.waitForSelector('img[alt^="scan"]', { timeout: 20000 });
await page.getByRole("button", { name: /^Распознать$/ }).click();
await page.waitForSelector("text=группа найдена", { timeout: 60000 });
await page.waitForTimeout(500);
await shot("51-ocr-draft");

const applyBtn = page.getByRole("button", { name: /Применить/ });
console.log("apply label:", await applyBtn.innerText());
await applyBtn.click();
await page.waitForTimeout(2500);
await shot("52-ocr-applied");
const count = await page.locator("text=Математический анализ").count();
console.log("lessons titled Матан in editor:", count);

await browser.close();
