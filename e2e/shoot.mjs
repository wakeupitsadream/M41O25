// Прогон входа + скриншоты основных экранов.
// BASE=http://localhost:3000 node e2e/shoot.mjs
import { BASE, launch } from "./lib.mjs";
import { INVITE, PIN, WHO } from "./lib.mjs";

const { browser, page, shot } = await launch();

await page.goto(`${BASE}/enter`, { waitUntil: "networkidle" });
await shot("01-enter");
await page.fill('input[name="code"]', INVITE.toLowerCase());
await page.click('button[type="submit"]');
await page.waitForURL("**/enter/who", { timeout: 20000 });
await page.waitForLoadState("networkidle");
await shot("02-who");
await page.click(`a:has-text("${WHO}")`);
await page.waitForURL("**/enter/pin**", { timeout: 20000 });
await page.waitForLoadState("networkidle");
await shot("03-pin");
const pin2 = await page.$('input[name="pin2"]');
await page.fill('input[name="pin"]', PIN);
if (pin2) await page.fill('input[name="pin2"]', PIN);
await page.click('button[type="submit"]');
await page.waitForURL("**/s**", { timeout: 30000 });
await page.waitForLoadState("networkidle");
await shot("04-schedule");
for (const [path, name] of [["/hw", "05-hw"], ["/group", "06-group"], ["/me", "07-me"]]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await shot(name);
}
await browser.close();
