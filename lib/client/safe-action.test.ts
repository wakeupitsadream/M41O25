import { test } from "node:test";
import assert from "node:assert/strict";
import { FAILED_MESSAGE, OFFLINE_MESSAGE, safeAction } from "./safe-action";

test("safeAction: результат действия отдаётся как есть, onError не зовётся", async () => {
  const shown: string[] = [];
  const res = await safeAction(async () => ({ ok: true as const, data: 7 }), (m) => shown.push(m));
  assert.deepEqual(res, { ok: true, data: 7 });
  assert.deepEqual(shown, []);
});

test("safeAction: ошибка в ActionResult не считается исключением — проверяет вызывающий", async () => {
  const shown: string[] = [];
  const res = await safeAction(async () => ({ ok: false as const, error: "Опрос закрыт" }), (m) => shown.push(m));
  assert.deepEqual(res, { ok: false, error: "Опрос закрыт" });
  assert.deepEqual(shown, []);
});

test("safeAction: исключение fetch без сети → сообщение про сеть и null", async () => {
  for (const message of ["Load failed", "Failed to fetch", "NetworkError when attempting to fetch resource."]) {
    const shown: string[] = [];
    const res = await safeAction(
      async () => {
        throw new TypeError(message);
      },
      (m) => shown.push(m),
    );
    assert.equal(res, null, message);
    assert.deepEqual(shown, [OFFLINE_MESSAGE], message);
  }
});

test("safeAction: прочее исключение → общее сообщение, null и запись в консоль", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const shown: string[] = [];
  const res = await safeAction(
    async () => {
      throw new Error("boom");
    },
    (m) => shown.push(m),
  );
  assert.equal(res, null);
  assert.deepEqual(shown, [FAILED_MESSAGE]);
  assert.equal(logged.mock.callCount(), 1);
});
