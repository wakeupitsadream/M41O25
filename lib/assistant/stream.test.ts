import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addUsage,
  createToolCallAccumulator,
  decodeLines,
  encodeEvent,
  estimateRoundUsage,
  historyArguments,
  parseToolArguments,
  usageFromProvider,
  IMAGE_TOKENS_ESTIMATE,
} from "./stream";
import type { ChatEvent } from "./types";

test("tool-call: аргументы склеиваются из фрагментов, id и имя — из первого", () => {
  const acc = createToolCallAccumulator();
  acc.push([{ index: 0, id: "call_a", type: "function", function: { name: "get_schedule", arguments: "" } }]);
  acc.push([{ index: 0, function: { arguments: '{"from":"2026-' } }]);
  acc.push([{ index: 0, function: { arguments: '09-24","to":' } }]);
  acc.push([{ index: 0, function: { arguments: '"2026-09-25"}' } }]);
  const [call] = acc.list();
  assert.equal(call.id, "call_a");
  assert.equal(call.name, "get_schedule");
  assert.deepEqual(parseToolArguments(call.arguments), { from: "2026-09-24", to: "2026-09-25" });
});

test("tool-call: два параллельных вызова с чередующимися фрагментами, второй начинается раньше первого", () => {
  const acc = createToolCallAccumulator();
  acc.push([{ index: 1, id: "call_b", function: { name: "get_homework", arguments: '{"subj' } }]);
  acc.push([{ index: 0, id: "call_a", function: { name: "get_schedule", arguments: "{" } }]);
  acc.push([
    { index: 1, function: { arguments: 'ect":"Матан"' } },
    { index: 0, function: { arguments: '"from":"2026-09-24"' } },
  ]);
  acc.push([{ index: 0, function: { arguments: "}" } }]);
  acc.push([{ index: 1, function: { arguments: "}" } }]);
  const calls = acc.list();
  assert.deepEqual(
    calls.map((c) => [c.index, c.id, c.name]),
    [
      [0, "call_a", "get_schedule"],
      [1, "call_b", "get_homework"],
    ],
  );
  assert.deepEqual(parseToolArguments(calls[0].arguments), { from: "2026-09-24" });
  assert.deepEqual(parseToolArguments(calls[1].arguments), { subject: "Матан" });
});

test("tool-call: имя, повторённое в каждом фрагменте, не удваивается; без id — свой id по кругу и индексу", () => {
  const acc = createToolCallAccumulator();
  acc.push([{ index: 0, function: { name: "get_news", arguments: '{"limit":' } }]);
  acc.push([{ index: 0, function: { name: "get_news", arguments: "5}" } }]);
  const [call] = acc.list(2);
  assert.equal(call.name, "get_news");
  assert.equal(call.id, "call_2_0");
  assert.deepEqual(parseToolArguments(call.arguments), { limit: 5 });
});

test("tool-call: шлюз без index — вызовы различаются по id, продолжение без id — к последнему", () => {
  const acc = createToolCallAccumulator();
  acc.push([{ id: "x1", function: { name: "get_polls", arguments: "{}" } }]);
  acc.push([{ id: "x2", function: { name: "get_tasks", arguments: "{" } }]);
  acc.push([{ function: { arguments: "}" } }]);
  assert.deepEqual(
    acc.list().map((c) => [c.id, c.name, c.arguments]),
    [
      ["x1", "get_polls", "{}"],
      ["x2", "get_tasks", "{}"],
    ],
  );
});

test("tool-call: фрагмент без имени (обрыв) не выполняется", () => {
  const acc = createToolCallAccumulator();
  acc.push([{ index: 0, function: { arguments: '{"a":1}' } }]);
  assert.equal(acc.size, 1);
  assert.deepEqual(acc.list(), []);
});

test("parseToolArguments: пусто — {}, битый JSON и не объект — null", () => {
  assert.deepEqual(parseToolArguments(""), {});
  assert.deepEqual(parseToolArguments("  "), {});
  assert.equal(parseToolArguments('{"from":'), null);
  assert.equal(parseToolArguments("[1,2]"), null);
  assert.equal(parseToolArguments("null"), null);
});

test("historyArguments: в историю tool_calls — только валидный JSON-объект, остальное — {}", () => {
  // Обрезано по max_tokens посреди аргументов: прослойка в Gemini/Claude разобрала бы строку и ответила 400 на весь круг.
  assert.equal(historyArguments('{"from":"2026-09-'), "{}");
  assert.equal(historyArguments(""), "{}");
  assert.equal(historyArguments("[1,2]"), "{}");
  assert.equal(historyArguments('{"from":"2026-09-24","to":"2026-09-25"}'), '{"from":"2026-09-24","to":"2026-09-25"}');
});

test("NDJSON: событие — одна строка, перевод строки в тексте экранирован", () => {
  const line = encodeEvent({ t: "delta", text: "первая\nвторая" });
  assert.ok(line.endsWith("\n"));
  assert.equal(line.split("\n").length, 2);
  const { events, rest } = decodeLines(line);
  assert.deepEqual(events, [{ t: "delta", text: "первая\nвторая" }]);
  assert.equal(rest, "");
});

test("NDJSON: строка, разрезанная посреди JSON, собирается из двух кусков", () => {
  const all: ChatEvent[] = [
    { t: "start", conversationId: "c1", messageId: "m1" },
    { t: "tool", name: "get_schedule" },
    { t: "delta", text: "Завтра две пары: {матан} и \"история\"" },
    { t: "error", message: "Помощник перегружен" },
  ];
  const wire = all.map(encodeEvent).join("");
  // Режем в каждой позиции: на любой границе результат одинаковый.
  for (let cut = 1; cut < wire.length; cut++) {
    const a = decodeLines(wire.slice(0, cut));
    const b = decodeLines(a.rest + wire.slice(cut));
    assert.deepEqual([...a.events, ...b.events], all, `разрез на ${cut}`);
    assert.equal(b.rest, "");
  }
});

test("NDJSON: хвост без перевода строки остаётся в rest, мусор и пустые строки пропускаются", () => {
  const { events, rest } = decodeLines('\n{"t":"delta","text":"а"}\nне json\n{"x":1}\n{"t":"delta","te');
  assert.deepEqual(events, [{ t: "delta", text: "а" }]);
  assert.equal(rest, '{"t":"delta","te');
});

test("usageFromProvider: поля OpenAI, cached из prompt_tokens_details; нет полей — null", () => {
  assert.deepEqual(usageFromProvider({ prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 300 } }), {
    prompt: 1200,
    completion: 80,
    cached: 300,
  });
  assert.deepEqual(usageFromProvider({ prompt_tokens: 10, completion_tokens: 2 }), { prompt: 10, completion: 2, cached: 0 });
  assert.equal(usageFromProvider(null), null);
  assert.equal(usageFromProvider({}), null);
});

test("estimateRoundUsage: вход по длине плюс картинки, выход по пришедшему тексту", () => {
  const u = estimateRoundUsage({ promptText: "а".repeat(700), images: 2, completionText: "б".repeat(35) });
  assert.deepEqual(u, { prompt: 200 + 2 * IMAGE_TOKENS_ESTIMATE, completion: 10, cached: 0 });
  assert.deepEqual(addUsage(u, { prompt: 1, completion: 2, cached: 3 }), { prompt: 2401, completion: 12, cached: 3 });
});
