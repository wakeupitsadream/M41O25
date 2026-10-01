import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionError, wrapAction, wrapForm } from "./actions";
import { fail, ok } from "./utils";

test("wrapAction: успех и fail проходят без изменений", async () => {
  assert.deepEqual(await wrapAction(async () => ok({ id: "1" })), { ok: true, data: { id: "1" } });
  assert.deepEqual(await wrapAction(async () => fail("Нет")), { ok: false, error: "Нет" });
});

test("wrapAction: своя ошибка (ActionError) → fail с её текстом", async () => {
  assert.deepEqual(
    await wrapAction(async () => {
      throw new ActionError("Недостаточно прав");
    }),
    { ok: false, error: "Недостаточно прав" },
  );
});

test("wrapAction: чужая ошибка (база, баг) → общий текст, подробности не утекают в тост", async () => {
  assert.deepEqual(
    await wrapAction(async () => {
      throw new Error('invalid input syntax for type uuid: "x"');
    }),
    { ok: false, error: "Что-то пошло не так — попробуй ещё раз" },
  );
  assert.deepEqual(
    await wrapAction(async () => {
      throw "boom";
    }),
    { ok: false, error: "Что-то пошло не так — попробуй ещё раз" },
  );
});

test("wrapAction и wrapForm: редирект Next не глотается, а пробрасывается", async () => {
  // Так Next помечает redirect()/notFound(): digest с префиксом NEXT_; unstable_rethrow узнаёт их по нему.
  const redirectLike = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/s;307;" });
  await assert.rejects(
    wrapAction(async () => {
      throw redirectLike;
    }),
    (e: unknown) => e === redirectLike,
  );
  await assert.rejects(
    wrapForm(async () => {
      throw redirectLike;
    }),
    (e: unknown) => e === redirectLike,
  );
});

test("wrapForm: своя ошибка — под полями, чужая — общий текст", async () => {
  assert.deepEqual(
    await wrapForm(async () => {
      throw new ActionError("Сессия не найдена — войди заново");
    }),
    { error: "Сессия не найдена — войди заново" },
  );
  assert.deepEqual(
    await wrapForm(async () => {
      throw new Error("relation does not exist");
    }),
    { error: "Что-то пошло не так — попробуй ещё раз" },
  );
  assert.deepEqual(await wrapForm(async () => ({ success: "Сохранено" })), { success: "Сохранено" });
});
