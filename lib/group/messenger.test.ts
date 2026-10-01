import { test } from "node:test";
import assert from "node:assert/strict";
import { messengerLink } from "./messenger";

test("messengerLink: @ник и адреса t.me → Telegram", () => {
  assert.deepEqual(messengerLink("@ivanov"), { href: "https://t.me/ivanov", label: "@ivanov" });
  assert.equal(messengerLink("t.me/ivanov").href, "https://t.me/ivanov");
  assert.equal(messengerLink("https://t.me/ivanov/").href, "https://t.me/ivanov");
  assert.equal(messengerLink("telegram.me/ivanov").href, "https://t.me/ivanov");
  assert.equal(messengerLink("https://t.me/+AbCdEf123").href, "https://t.me/+AbCdEf123", "инвайт-ссылка — путь как есть");
});

test("messengerLink: vk.com и vk.me → ВК", () => {
  assert.equal(messengerLink("vk.com/id123").href, "https://vk.com/id123");
  assert.equal(messengerLink("https://m.vk.com/durov").href, "https://vk.com/durov");
  assert.equal(messengerLink("vk.ru/durov").href, "https://vk.com/durov");
  assert.equal(messengerLink("vk.me/durov").href, "https://vk.me/durov");
});

test("messengerLink: адрес внутри текста — ссылка на весь чип, подпись как написано", () => {
  assert.deepEqual(messengerLink("Telegram @ivanov"), { href: "https://t.me/ivanov", label: "Telegram @ivanov" });
  assert.equal(messengerLink("ВК / Telegram @ivanov").href, "https://t.me/ivanov");
  assert.equal(messengerLink("пиши в тг: t.me/ivanov.").href, "https://t.me/ivanov");
  assert.equal(messengerLink("  @ivanov  ").label, "@ivanov");
});

test("messengerLink: неоднозначное и не адрес — текст без ссылки", () => {
  assert.equal(messengerLink("ВК @ivanov").href, null, "голый @ник рядом с ВК без Telegram");
  assert.equal(messengerLink("WhatsApp +7 999 123-45-67").href, null);
  assert.equal(messengerLink("@abc").href, null, "короче 5 символов — не ник Telegram");
  assert.equal(messengerLink("vk.com").href, null, "без пути");
  assert.equal(messengerLink("ivanov@mail.ru").href, null);
  assert.equal(messengerLink("").href, null);
});
