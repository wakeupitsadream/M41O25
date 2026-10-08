import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { loadConfig } from "../config.js";
import type { Store } from "../db/store.js";
import { testStore } from "../db/testdb.js";
import { createRouter } from "../llm/router.js";
import type { MaxClient } from "../max/client.js";
import type { Attachment, Message, NewMessageBody, Update } from "../max/types.js";
import type { Deps } from "./deps.js";
import { actionFromCaption, handleUpdate } from "./handler.js";

const TOKEN = "test-token-ABC123";
const OWNER = 501;
const STRANGER = 777;
const CHAT = 9001;

let store: Store;
let close: () => Promise<void>;
before(async () => {
  ({ store, close } = await testStore());
});
after(async () => close());

type Sent = { chatId: number; body: NewMessageBody; mid: string };

function fakeMax() {
  const sent: Sent[] = [];
  const edits: Array<{ mid: string; body: NewMessageBody }> = [];
  const deleted: string[] = [];
  const answers: Array<{ id: string; body: { notification?: string; message?: NewMessageBody } }> = [];
  let commands = 0;
  let n = 0;
  const client: MaxClient = {
    getMe: async () => ({ user_id: 1, first_name: "Бот" }),
    getSubscriptions: async () => [],
    subscribe: async () => {},
    unsubscribe: async () => {},
    sendMessage: async (target, body) => {
      const mid = `bot-${++n}`;
      sent.push({ chatId: "chatId" in target ? target.chatId : -1, body, mid });
      return { recipient: { chat_id: CHAT, chat_type: "dialog", user_id: null }, timestamp: Date.now(), body: { mid, text: body.text ?? null } } as Message;
    },
    editMessage: async (mid, body) => {
      edits.push({ mid, body });
    },
    deleteMessage: async (mid) => {
      deleted.push(mid);
    },
    answerCallback: async (id, body) => {
      answers.push({ id, body });
    },
    sendAction: async () => {},
    setCommands: async () => {
      commands++;
    },
    download: async (url) => {
      if (url.endsWith(".ogg")) return { data: Buffer.from("OggS\0\x02voice"), contentType: "audio/ogg" };
      return { data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: "image/jpeg" };
    },
  };
  return { client, sent, edits, deleted, answers, commands: () => commands };
}

/** Подставной Gemini: отвечает по смыслу системного промпта. */
function fakeGemini(opts: { tasks?: number; fail?: boolean } = {}) {
  const calls: Array<{ model: string; system: string; parts: any[] }> = [];
  const fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));
    const model = /models\/([^:]+):/.exec(url)?.[1] ?? "?";
    const system = body.systemInstruction?.parts?.[0]?.text ?? "";
    calls.push({ model, system, parts: body.contents.at(-1).parts });
    if (opts.fail) return new Response(JSON.stringify({ error: { status: "UNAVAILABLE", message: "overloaded" } }), { status: 503 });
    let text = "**Ответ:** x = ±2\n\n**Решение:**\n1. $x^2 = 4$, значит $x = \\pm 2$.";
    if (system.includes("Ты анализируешь фото")) {
      const tasks = Array.from({ length: opts.tasks ?? 1 }, (_, i) => ({ label: `№${i + 1}`, summary: `задача ${i + 1}`, text: `условие ${i + 1}` }));
      text = JSON.stringify({ tasks, handwritten_solution: false, readable: true });
    } else if (system.includes("Составь 3 вопроса")) {
      text = '```json\n{"questions":["Что такое x²?","Сколько корней?","Почему ±?"],"answers":["квадрат","два","симметрия"]}\n```';
    } else if (system.includes("распознавания речи")) {
      text = "реши уравнение икс в квадрате равно четырём";
    } else if (system.includes("Режим «Болталка»")) {
      text = "Привет! Всё норм 😄";
    } else if (system.includes("Сократи свой предыдущий ответ")) {
      text = "x = ±2";
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function makeDeps(max: MaxClient, fetch: typeof globalThis.fetch): Deps {
  const config = loadConfig({ MAX_BOT_TOKEN: TOKEN, GEMINI_API_KEY: "g-key", APP_TZ: "Asia/Yekaterinburg" });
  return {
    config,
    max,
    store,
    router: createRouter({ config, store, fetch }),
    fetch,
    now: () => new Date(),
    sleep: async () => {},
    deadline: Date.now() + 120_000,
  };
}

let seq = 0;
function message(userId: number, opts: { text?: string; attachments?: Attachment[]; link?: Message["link"] } = {}): Update {
  return {
    update_type: "message_created",
    timestamp: Date.now(),
    message: {
      sender: { user_id: userId, first_name: "Макс" },
      recipient: { chat_id: CHAT, chat_type: "dialog", user_id: null },
      timestamp: Date.now(),
      body: { mid: `u-${++seq}`, text: opts.text ?? null, attachments: opts.attachments ?? null },
      link: opts.link ?? null,
    },
  };
}

function callback(payload: string, messageMid = "bot-x", userId = OWNER): Update {
  return {
    update_type: "message_callback",
    timestamp: Date.now(),
    callback: { timestamp: Date.now(), callback_id: `cb-${++seq}`, payload, user: { user_id: userId } },
    message: { recipient: { chat_id: CHAT, chat_type: "dialog", user_id: null }, timestamp: Date.now(), body: { mid: messageMid, text: "" } },
  };
}

const photo = (n: number): Attachment => ({ type: "image", payload: { url: `https://i.oneme.ru/photo${n}.jpg`, token: "t", photo_id: n } });
const lastText = (sent: Sent[]) => sent.at(-1)?.body.text ?? "";
const payloads = (s: Sent | undefined) => (s?.body.attachments?.[0]?.payload.buttons ?? []).flat().map((b) => ("payload" in b ? b.payload : ""));

beforeEach(async () => {
  await store.db.query("DELETE FROM bot_state WHERE key = 'owner'");
  await store.db.query("DELETE FROM chats");
  await store.db.query("DELETE FROM messages");
  await store.db.query("DELETE FROM items");
  await store.db.query("DELETE FROM model_state");
});

async function claim(deps: Deps) {
  await handleUpdate(deps, message(OWNER, { text: "ABC123" }));
}

test("привязка владельца: подсказка, неверный код, верный код", async () => {
  const max = fakeMax();
  const deps = makeDeps(max.client, fakeGemini().fetch);
  await handleUpdate(deps, message(OWNER, { text: "/start" }));
  assert.match(lastText(max.sent), /последние 6 символов токена/);
  await handleUpdate(deps, message(OWNER, { text: "XXXXXX" }));
  assert.match(lastText(max.sent), /последние 6 символов/);
  await claim(deps);
  assert.match(lastText(max.sent), /бот привязан к тебе/);
  assert.equal(max.commands(), 1);
  assert.deepEqual(await store.getState("owner").then((o: any) => o.userId), OWNER);
});

test("чужой получает одно сообщение в сутки, бот ему не отвечает", async () => {
  const max = fakeMax();
  const deps = makeDeps(max.client, fakeGemini().fetch);
  await claim(deps);
  const before = max.sent.length;
  await handleUpdate(deps, message(STRANGER, { text: "реши задачу" }));
  await handleUpdate(deps, message(STRANGER, { text: "ну реши" }));
  assert.equal(max.sent.length, before + 1);
  assert.match(lastText(max.sent), /личный бот/);
});

test("вопрос текстом: заглушка, ответ с формулами Unicode, кнопки, подпись модели, история", async () => {
  const max = fakeMax();
  const llm = fakeGemini();
  const deps = makeDeps(max.client, llm.fetch);
  await claim(deps);
  const start = max.sent.length;
  await handleUpdate(deps, message(OWNER, { text: "реши x^2 = 4" }));
  const out = max.sent.slice(start);
  assert.equal(out[0]!.body.text, "🧮 Решаю…");
  const answer = out.at(-1)!;
  assert.match(answer.body.text!, /<b>Ответ:<\/b> x = ±2/);
  assert.match(answer.body.text!, /x² = 4/);
  assert.ok(!answer.body.text!.includes("$"), "LaTeX не просочился");
  assert.match(answer.body.text!, /<i>⚙️ Gemini 3\.8 Flash<\/i>$/);
  assert.equal(answer.body.format, "html");
  assert.ok(answer.body.link?.mid.startsWith("u-"), "ответ цитирует вопрос");
  const p = payloads(answer);
  assert.ok(p.some((x) => /^f:\w+:short$/.test(x)) && p.includes("new") && p.includes("menu"));
  assert.ok(max.deleted.includes(out[0]!.mid), "заглушка удалена");
  assert.equal(llm.calls[0]!.model, "gemini-3.8-flash");
  assert.match(llm.calls[0]!.system, /Режим «Решатель»/);
  const chat = await store.getChat(CHAT, OWNER);
  const hist = await store.history(CHAT, chat.topic, null, 10);
  assert.deepEqual(hist.map((m) => m.role), ["user", "assistant"]);
});

test("повторная доставка события обрабатывается один раз", async () => {
  const max = fakeMax();
  const llm = fakeGemini();
  const deps = makeDeps(max.client, llm.fetch);
  await claim(deps);
  const upd = message(OWNER, { text: "привет" });
  await handleUpdate(deps, upd);
  const calls = llm.calls.length;
  await handleUpdate(deps, upd);
  assert.equal(llm.calls.length, calls);
});

test("фото без подписи → кнопки; «Решить» → на фото 2 задания → выбор → решение выбранного", async () => {
  const max = fakeMax();
  const llm = fakeGemini({ tasks: 2 });
  const deps = makeDeps(max.client, llm.fetch);
  await claim(deps);
  await handleUpdate(deps, message(OWNER, { attachments: [photo(1)] }));
  const prompt = max.sent.at(-1)!;
  assert.match(prompt.body.text!, /Что сделать с фото/);
  const solve = payloads(prompt).find((x) => x.endsWith(":solve"))!;
  assert.ok(solve);

  await handleUpdate(deps, callback(solve, prompt.mid));
  assert.ok(max.deleted.includes(prompt.mid), "кнопки под фото убраны");
  const choice = max.edits.at(-1)!;
  assert.match(choice.body.text!, /На фото 2 задания/);
  const pick = (choice.body.attachments?.[0]?.payload.buttons ?? []).flat().map((b) => ("payload" in b ? b.payload : ""));
  assert.ok(pick.some((x) => x.endsWith(":all")));
  const second = pick.find((x) => x.endsWith(":2"))!;

  const callsBefore = llm.calls.length;
  await handleUpdate(deps, callback(second, choice.mid));
  const solveCall = llm.calls[callsBefore]!;
  assert.equal(solveCall.model, "gemini-3.8-flash");
  assert.ok(solveCall.parts.some((p: any) => p.inlineData?.mimeType === "image/jpeg"), "фото ушло в модель");
  assert.ok(solveCall.parts.some((p: any) => /Реши задание №2/.test(p.text ?? "")));
  assert.match(lastText(max.sent), /Ответ:/);

  // Повторное нажатие той же кнопки не запускает второе решение.
  const n = llm.calls.length;
  await handleUpdate(deps, callback(second, choice.mid));
  assert.equal(llm.calls.length, n);
});

test("несколько фото одновременно собираются в одну пачку, текст после них становится подписью", async () => {
  const max = fakeMax();
  const llm = fakeGemini();
  const deps = makeDeps(max.client, llm.fetch);
  await claim(deps);
  await Promise.all([1, 2, 3].map((i) => handleUpdate(deps, message(OWNER, { attachments: [photo(i)] }))));
  const prompts = max.sent.filter((s) => /Фото: 3|Что сделать/.test(s.body.text ?? ""));
  assert.ok(prompts.length >= 1);
  assert.match(prompts.at(-1)!.body.text!, /Фото: 3/);

  await handleUpdate(deps, message(OWNER, { text: "проверь моё решение" }));
  const call = llm.calls.at(-1)!;
  assert.equal(call.parts.filter((p: any) => p.inlineData).length, 3);
  assert.match(call.system, /проверить решение студента/);
  assert.match(lastText(max.sent), /Ответ|Решение/);
});

test("кнопки под ответом: короче (лёгкая модель), проверь меня → ответы", async () => {
  const max = fakeMax();
  const llm = fakeGemini();
  const deps = makeDeps(max.client, llm.fetch);
  await claim(deps);
  await handleUpdate(deps, message(OWNER, { text: "реши x^2 = 4" }));
  const answer = max.sent.at(-1)!;
  const short = payloads(answer).find((x) => x.endsWith(":short"))!;
  await handleUpdate(deps, callback(short, answer.mid));
  assert.equal(llm.calls.at(-1)!.model, "gemini-3.5-flash-lite");
  assert.match(lastText(max.sent), /x = ±2/);

  const quiz = payloads(answer).find((x) => x.endsWith(":quiz"))!;
  await handleUpdate(deps, callback(quiz, answer.mid));
  const quizMsg = max.edits.at(-1) ?? { body: max.sent.at(-1)!.body };
  assert.match(quizMsg.body.text!, /Проверь себя/);
  const reveal = (quizMsg.body.attachments?.[0]?.payload.buttons ?? []).flat().map((b) => ("payload" in b ? b.payload : ""))[0]!;
  assert.match(reveal, /^q:/);
  await handleUpdate(deps, callback(reveal));
  assert.match(lastText(max.sent), /Ответы[\s\S]*квадрат/);
});

test("смена режима на болталку: ответ без заглушки, кнопок и подписи", async () => {
  const max = fakeMax();
  const llm = fakeGemini();
  const deps = makeDeps(max.client, llm.fetch);
  await claim(deps);
  await handleUpdate(deps, callback("m:chat"));
  assert.equal((await store.getChat(CHAT, OWNER)).mode, "chat");
  assert.match(max.answers.at(-1)!.body.notification!, /Болталка/);
  const start = max.sent.length;
  await handleUpdate(deps, message(OWNER, { text: "как дела?" }));
  const out = max.sent.slice(start);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.body.text, "Привет! Всё норм 😄");
  assert.equal(out[0]!.body.attachments, undefined);
  assert.equal(llm.calls.at(-1)!.model, "gemini-3.5-flash-lite");
});

test("голосовое: распознаётся, показывается текстом и уходит в ответ", async () => {
  const max = fakeMax();
  const llm = fakeGemini();
  const deps = makeDeps(max.client, llm.fetch);
  await claim(deps);
  await handleUpdate(deps, message(OWNER, { attachments: [{ type: "audio", payload: { url: "https://i.oneme.ru/voice.ogg", token: "a" } }] }));
  const echo = max.sent.find((s) => (s.body.text ?? "").startsWith("🎙"));
  assert.match(echo!.body.text!, /икс в квадрате/);
  const transcribeCall = llm.calls.find((c) => c.system.includes("распознавания речи"))!;
  assert.equal(transcribeCall.parts[0].inlineData.mimeType, "audio/ogg");
  assert.match(lastText(max.sent), /Ответ:/);
});

test("все модели недоступны — понятное сообщение вместо заглушки", async () => {
  const max = fakeMax();
  const deps = makeDeps(max.client, fakeGemini({ fail: true }).fetch);
  await claim(deps);
  await handleUpdate(deps, message(OWNER, { text: "реши" }));
  const edit = max.edits.at(-1)!;
  assert.match(edit.body.text!, /бесплатные модели сейчас недоступны/);
  assert.match(edit.body.text!, /перегружена/);
});

test("/status и /profile отвечают без ошибок", async () => {
  const max = fakeMax();
  const deps = makeDeps(max.client, fakeGemini().fetch);
  await claim(deps);
  await handleUpdate(deps, message(OWNER, { text: "/status" }));
  assert.match(lastText(max.sent), /Состояние[\s\S]*Gemini 3\.8 Flash[\s\S]*нет ключа/);
  await handleUpdate(deps, message(OWNER, { text: "/profile люблю статистику" }));
  assert.match(lastText(max.sent), /люблю статистику/);
});

test("подпись к фото выбирает действие", () => {
  assert.equal(actionFromCaption("Проверь, верно ли решено", "solve"), "check");
  assert.equal(actionFromCaption("сделай конспект", "solve"), "notes");
  assert.equal(actionFromCaption("перепиши текст", "tutor"), "ocr");
  assert.equal(actionFromCaption("реши 3", "chat"), "chat");
  assert.equal(actionFromCaption("реши 3", "ticket"), "solve");
});

test("регрессия: после 5 попыток привязки даже верный код не принимается", async () => {
  const max = fakeMax();
  const deps = makeDeps(max.client, fakeGemini().fetch);
  for (let i = 0; i < 5; i++) await handleUpdate(deps, message(STRANGER, { text: `guess${i}` }));
  await handleUpdate(deps, message(STRANGER, { text: "ABC123" }));
  assert.equal(await store.getState("owner"), null);
  assert.match(lastText(max.sent), /Слишком много попыток/);
  await store.db.query("DELETE FROM items WHERE id LIKE 'claim:%'");
});

test("регрессия: ссылка «ответ на» отвергнута — повтор с тем же HTML без ссылки", async () => {
  const max = fakeMax();
  const deps = makeDeps(max.client, fakeGemini().fetch);
  await claim(deps);
  const sendMessage = max.client.sendMessage;
  const tried: NewMessageBody[] = [];
  max.client.sendMessage = async (target, body) => {
    tried.push(body);
    if (body.link) {
      const { MaxApiError } = await import("../max/client.js");
      throw new MaxApiError(400, "proto.payload", "link not found");
    }
    return sendMessage(target, body);
  };
  await handleUpdate(deps, message(OWNER, { text: "реши x^2 = 4" }));
  const final = max.sent.at(-1)!;
  assert.equal(final.body.format, "html");
  assert.match(final.body.text!, /<b>Ответ:<\/b>/);
  assert.equal(final.body.link ?? null, null);
});

test("регрессия: неизвестное действие под фото не выбрасывает пачку", async () => {
  const max = fakeMax();
  const deps = makeDeps(max.client, fakeGemini().fetch);
  await claim(deps);
  await handleUpdate(deps, message(OWNER, { attachments: [photo(9)] }));
  const prompt = max.sent.at(-1)!;
  const id = payloads(prompt)[0]!.split(":")[1]!;
  await handleUpdate(deps, callback(`p:${id}:hack`, prompt.mid));
  assert.ok(await store.getPending(CHAT), "фото на месте");
});

test("регрессия: пересланное фото — ответ ссылается на сообщение этого чата, а не на чужой mid", async () => {
  const max = fakeMax();
  const deps = makeDeps(max.client, fakeGemini().fetch);
  await claim(deps);
  const upd = message(OWNER, {
    text: "реши",
    link: { type: "forward", message: { mid: "foreign-mid", text: null, attachments: [photo(5)] } },
  });
  await handleUpdate(deps, upd);
  const ownMid = (upd as { message: Message }).message.body.mid;
  const links = max.sent.map((s) => s.body.link?.mid).filter(Boolean);
  assert.ok(links.every((m) => m !== "foreign-mid"));
  assert.ok(links.includes(ownMid));
});
