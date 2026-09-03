import { test } from "node:test";
import assert from "node:assert/strict";
import { firstName, generateInviteSuffix, pluralRu } from "./utils";

test("pluralRu: русские формы по числу", () => {
  const f = (n: number) => pluralRu(n, "пара", "пары", "пар");
  assert.equal(f(1), "пара");
  assert.equal(f(2), "пары");
  assert.equal(f(4), "пары");
  assert.equal(f(5), "пар");
  assert.equal(f(11), "пар");
  assert.equal(f(12), "пар");
  assert.equal(f(21), "пара");
  assert.equal(f(22), "пары");
  assert.equal(f(101), "пара");
  assert.equal(f(111), "пар");
  assert.equal(f(0), "пар");
});

test("firstName: «Фамилия Имя» → Имя, одно слово — как есть", () => {
  assert.equal(firstName("Батутин Максим"), "Максим");
  assert.equal(firstName("Мадонна"), "Мадонна");
  assert.equal(firstName("Иванова  Анастасия Петровна"), "Анастасия");
});

test("generateInviteSuffix: XXXX-XXXX без похожих символов", () => {
  for (let i = 0; i < 50; i++) {
    const s = generateInviteSuffix();
    assert.match(s, /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}$/);
  }
});
