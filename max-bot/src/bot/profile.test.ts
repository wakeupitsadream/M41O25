import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadConfig } from "../config.js";
import type { Store } from "../db/store.js";
import { testStore } from "../db/testdb.js";
import type { Deps } from "./deps.js";
import { profileForPrompt, raspisonProfile } from "./profile.js";

let store: Store;
let close: () => Promise<void>;
before(async () => {
  ({ store, close } = await testStore());
});
after(async () => close());

function deps(fetch: typeof globalThis.fetch, env: Record<string, string> = {}, now = new Date("2026-10-08T10:00:00Z")): Deps {
  return {
    config: loadConfig({ RASPISON_URL: "https://raspison.vercel.app/", RASPISON_BOT_KEY: "k", ...env }),
    max: {} as Deps["max"],
    store,
    router: {} as Deps["router"],
    fetch,
    now: () => now,
    sleep: async () => {},
    deadline: Date.now() + 60_000,
  };
}

test("профиль: предметы из Raspison с ключом, кэш, откат на кэш при сбое", async () => {
  const urls: string[] = [];
  let fail = false;
  const fetch = (async (input: URL | string, init?: RequestInit) => {
    urls.push(String(input));
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer k");
    if (fail) return new Response("down", { status: 503 });
    return Response.json({ group: { name: "Группа М41О25", shortName: "М41О25" }, subjects: [{ name: "Микроэкономика" }, { name: "Матан", shortName: "Матан" }] });
  }) as typeof globalThis.fetch;

  const d = deps(fetch, { RASPISON_GROUP: "М41О25" });
  const p = await profileForPrompt(d);
  assert.equal(urls[0], "https://raspison.vercel.app/api/bot/profile?group=%D0%9C41%D0%9E25");
  assert.match(p, /^студент 2 курса РАНХиГС/);
  assert.match(p, /группа М41О25\. Предметы семестра: Микроэкономика, Матан\.$/);

  await raspisonProfile(d);
  assert.equal(urls.length, 1, "второй раз — из кэша");

  fail = true;
  const forced = await raspisonProfile(d, true);
  assert.equal(urls.length, 2);
  assert.equal(forced?.subjects?.length, 2, "при сбое отдаётся последний удачный ответ");

  await store.setState("profile_about", "люблю статистику");
  assert.match(await profileForPrompt(d), /^люблю статистику, группа М41О25/);
});

test("профиль без Raspison — только курс и направление", async () => {
  await store.deleteState("profile_about");
  const d: Deps = { ...deps((async () => new Response()) as typeof globalThis.fetch), config: loadConfig({}) };
  assert.equal(await profileForPrompt(d), "студент 2 курса РАНХиГС (Оренбургский филиал), направление «Менеджмент», профиль «Управление бизнесом».");
});
