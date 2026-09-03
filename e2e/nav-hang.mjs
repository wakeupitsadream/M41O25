// Воспроизведение зависания клиентской навигации в production-сборке (docs/ROADMAP.md, «Открытая проблема P0»).
// Не входит в `npm run e2e`. Нужны production-сборка на BASE и страница назначения примерно со 100 записями.
//   BASE=http://localhost:3001 PW_CHROMIUM=/opt/pw-browsers/chromium node e2e/nav-hang.mjs
//   TARGET=/group/news FROM=/group TRIES=6   — куда и откуда идём, сколько попыток
//   MODE=buffer                              — отдавать RSC-ответ браузеру одним куском (без гонки на чанках)
//   SW=1                                     — не блокировать service worker
// На каждую попытку печатает, дошла ли навигация, состояние FiberRoot (pendingLanes/suspendedLanes/pingedLanes/
// callbackNode) и статистику чтения RSC-потока страницей (чанки, байты, done).
import { chromium, devices } from "@playwright/test";
import { BASE, INVITE, PIN, WHO } from "./lib.mjs";

const TARGET = process.env.TARGET ?? "/group/contacts";
const FROM = process.env.FROM ?? "/group";
const TRIES = Number(process.env.TRIES ?? 6);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({
  ...devices["iPhone 15"],
  locale: "ru-RU",
  timezoneId: "Asia/Yekaterinburg",
  serviceWorkers: process.env.SW === "1" ? "allow" : "block",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_INTERNET|favicon|404/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 200));
});

// Считаем чанки RSC-потока так, как их видит Flight-клиент: помечаем тело ответа и оборачиваем reader.read().
await page.addInitScript(() => {
  const stats = (window.__rscStreams = []);
  const tagged = new WeakMap();
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await origFetch.call(this, input, init);
    if ((res.headers.get("content-type") || "").includes("text/x-component") && res.body) {
      const entry = { url: String(res.url).slice(0, 80), chunks: 0, bytes: 0, done: false, t0: Math.round(performance.now()), tEnd: null, lastChunkAt: null };
      stats.push(entry);
      tagged.set(res.body, entry);
    }
    return res;
  };
  const origGetReader = ReadableStream.prototype.getReader;
  ReadableStream.prototype.getReader = function (...args) {
    const reader = origGetReader.apply(this, args);
    const entry = tagged.get(this);
    if (entry) {
      const read = reader.read.bind(reader);
      reader.read = async () => {
        const r = await read();
        if (r.done) {
          entry.done = true;
          entry.tEnd = Math.round(performance.now());
        } else {
          entry.chunks++;
          entry.bytes += r.value.byteLength;
          entry.lastChunkAt = Math.round(performance.now());
        }
        return r;
      };
    }
    return reader;
  };
});

if (process.env.MODE === "buffer") {
  await page.route("**/*", async (route) => {
    if (route.request().headers()["rsc"] !== "1") return route.continue();
    const res = await route.fetch();
    const headers = { ...res.headers() };
    delete headers["content-encoding"];
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    return route.fulfill({ status: res.status(), headers, body: await res.body() });
  });
}

await page.goto(`${BASE}/enter`, { waitUntil: "networkidle" });
await page.fill('input[name="code"]', INVITE);
await page.click('button[type="submit"]');
await page.waitForURL("**/enter/who");
await page.click(`a:has-text("${WHO}")`);
await page.waitForURL("**/enter/pin**");
await page.waitForLoadState("networkidle");
await page.fill('input[name="pin"]', PIN);
await page.click('button[type="submit"]');
await page.waitForURL("**/s**");

const inspect = () =>
  page.evaluate(() => {
    const key = Object.keys(document).find((k) => k.startsWith("__reactContainer"));
    const root = key ? document[key]?.stateNode : null;
    const out = { href: location.pathname };
    if (root) for (const k of ["pendingLanes", "suspendedLanes", "pingedLanes", "warmLanes", "callbackPriority"]) out[k] = root[k];
    if (root) out.callbackNode = root.callbackNode ? "set" : null;
    const streams = window.__rscStreams ?? [];
    out.stream = streams.length ? streams[streams.length - 1] : null;
    return out;
  });

let hangs = 0;
for (let i = 0; i < TRIES; i++) {
  await page.goto(`${BASE}${FROM}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const t0 = Date.now();
  await page.click(`a[href="${TARGET}"]`);
  const ok = await page
    .waitForURL(`**${TARGET}`, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  console.log(`#${i + 1} ok=${ok} ${Date.now() - t0}ms`, JSON.stringify(await inspect()));
  if (!ok) {
    hangs++;
    const late = await page
      .waitForURL(`**${TARGET}`, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    console.log(`   +10s: navigated=${late}`, JSON.stringify(await inspect()));
  }
}
console.log(`hangs ${hangs}/${TRIES}`);
await browser.close();
process.exit(hangs ? 1 : 0);
