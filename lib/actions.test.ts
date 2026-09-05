import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapAction } from "./actions";
import { fail, ok } from "./utils";

test("wrapAction: успех и fail проходят без изменений", async () => {
  assert.deepEqual(await wrapAction(async () => ok({ id: "1" })), { ok: true, data: { id: "1" } });
  assert.deepEqual(await wrapAction(async () => fail("Нет")), { ok: false, error: "Нет" });
});

test("wrapAction: исключение → fail с текстом ошибки", async () => {
  assert.deepEqual(
    await wrapAction(async () => {
      throw new Error("База недоступна");
    }),
    { ok: false, error: "База недоступна" },
  );
});

test("wrapAction: не-Error → общий текст", async () => {
  assert.deepEqual(
    await wrapAction(async () => {
      throw "boom";
    }),
    { ok: false, error: "Что-то пошло не так" },
  );
});
