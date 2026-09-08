import { test } from "node:test";
import assert from "node:assert/strict";
import { PROD_HOST, classifyError, errorCopy, probeVerdict } from "./error-kind";

test("classifyError: «нет сети» — только когда браузер прямо сказал offline", () => {
  assert.equal(classifyError({ online: false, message: "Что угодно" }), "offline");
  assert.equal(classifyError({ online: false, message: "Failed to fetch" }), "offline");
  assert.equal(classifyError({ online: false }), "offline");
});

test("classifyError: сеть есть, ошибка сетевого вида — это молчащий сервер, а не «нет сети»", () => {
  assert.equal(classifyError({ online: true, message: "Failed to fetch" }), "server-error");
  assert.equal(classifyError({ online: true, message: "Load failed" }), "server-error");
  assert.equal(classifyError({ online: true, message: "TypeError: NetworkError when attempting to fetch resource." }), "server-error");
  assert.equal(classifyError({ online: true, message: "fetch failed" }), "server-error");
});

test("classifyError: 500 из установленной PWA — unknown, не офлайн (тот самый случай с preview без DATABASE_URL)", () => {
  assert.equal(classifyError({ online: true, message: "An error occurred in the Server Components render." }), "unknown");
  assert.equal(classifyError({ online: true, message: "DATABASE_URL не задан" }), "unknown");
  assert.equal(classifyError({ online: true, message: "" }), "unknown");
  assert.equal(classifyError({ online: true }), "unknown");
  // navigator недоступен (SSR, старый браузер) — врать про сеть не имеем права
  assert.equal(classifyError({ message: "Internal Server Error" }), "unknown");
  assert.equal(classifyError({}), "unknown");
});

test("errorCopy: три разных заголовка, «Нет сети» только у офлайна", () => {
  assert.equal(errorCopy("offline").title, "Нет сети");
  assert.equal(errorCopy("server-error").title, "Сервер не ответил");
  assert.equal(errorCopy("unknown").title, "Что-то пошло не так");
  const titles = new Set([errorCopy("offline").hint, errorCopy("server-error").hint, errorCopy("unknown").hint]);
  assert.equal(titles.size, 3);
  assert.match(errorCopy("unknown").hint, /код ошибки/);
});

test("probeVerdict: сервер не ответил — дело может быть в связи", () => {
  assert.deepEqual(probeVerdict({ reached: false }).tone, "bad");
  assert.match(probeVerdict({ reached: false }).text, /недоступен/);
});

test("probeVerdict: сервер ответил 200 — связь ни при чём", () => {
  const v = probeVerdict({ reached: true, status: 200, env: "production", branch: "main" });
  assert.equal(v.tone, "ok");
  assert.match(v.text, /дело не в связи/);
});

test("probeVerdict: ответила тестовая копия — зовём переставить приложение с рабочего адреса", () => {
  const v = probeVerdict({ reached: true, status: 200, env: "preview", branch: "claude/fix-42" });
  assert.equal(v.tone, "warn");
  assert.match(v.text, /тестовая копия \(ветка claude\/fix-42\)/);
  assert.match(v.text, new RegExp(PROD_HOST.replace(/\./g, "\\.")));
  // ветка неизвестна — текст остаётся связным
  assert.match(probeVerdict({ reached: true, status: 200, env: "preview" }).text, /тестовая копия, а не рабочее/);
});

test("probeVerdict: 5xx на самой проверке — поломка сервера, а не связи", () => {
  const v = probeVerdict({ reached: true, status: 502 });
  assert.equal(v.tone, "bad");
  assert.match(v.text, /502/);
});

test("probeVerdict: неожиданный код (старый деплой без /api/health) — связь всё равно есть", () => {
  const v = probeVerdict({ reached: true, status: 404, env: "production" });
  assert.equal(v.tone, "warn");
  assert.match(v.text, /404/);
  assert.match(v.text, /не в связи/);
});
