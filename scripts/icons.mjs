// Генерация иконок PWA из HTML через Chromium: icon-192/512, maskable 512 и apple-touch-icon 180.
// node scripts/icons.mjs   (PW_CHROMIUM=/path/to/chrome при необходимости)
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const out = path.join(process.cwd(), "public", "icons");
fs.mkdirSync(out, { recursive: true });

const html = (size, { maskable = false, radius = 0.22 } = {}) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@800&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;background:${maskable ? "#0a0a0e" : "transparent"};}
  .tile{width:${size}px;height:${size}px;border-radius:${maskable ? 0 : Math.round(size * radius)}px;background:#0a0a0e;position:relative;overflow:hidden;
    display:flex;align-items:center;justify-content:center;}
  .glow{position:absolute;inset:-30%;background:radial-gradient(60% 60% at 50% 20%,rgba(200,255,46,.35),transparent 65%);}
  .r{position:relative;font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:${Math.round(size * 0.56)}px;line-height:1;color:#f4f4f6;letter-spacing:-0.05em;transform:translateY(-${Math.round(size*0.02)}px)}
  .r b{color:#c8ff2e;font-weight:800}
</style></head><body><div class="tile"><div class="glow"></div><div class="r">R<b>.</b></div></div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });

const render = async (file, size, opts) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, opts), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, file), omitBackground: !opts?.maskable, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("icon", file);
};

await render("icon-512.png", 512, {});
await render("icon-192.png", 192, {});
await render("icon-512-maskable.png", 512, { maskable: true });
await render("apple-touch-icon.png", 180, { maskable: true });
await browser.close();
