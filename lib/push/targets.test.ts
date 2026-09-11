import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { classifyPushError, classifyPushStatus } from "@/lib/push/errors";
import { pickTargets, type PushTarget } from "@/lib/push/targets";
import { normalizeTopics } from "@/lib/push/topics";

const sub = (id: string, userId: string, topics: string[]): PushTarget => ({ id, userId, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "a", topics });

const ids = (list: PushTarget[]) => list.map((s) => s.id);

test("автору собственной новости пуш не уходит", () => {
  const subs = [sub("1", "max", ["news"]), sub("2", "anya", ["news"])];
  deepStrictEqual(ids(pickTargets(subs, { topic: "news", exceptUserId: "max" })), ["2"]);
});

test("тема выключена — устройство пропускаем", () => {
  const subs = [sub("1", "anya", ["news"]), sub("2", "anya", ["polls"]), sub("3", "oleg", [])];
  deepStrictEqual(ids(pickTargets(subs, { topic: "polls", exceptUserId: null })), ["2"]);
});

test("домашка: уходит подписанным на неё, кроме того, кто её добавил", () => {
  const subs = [sub("1", "max", ["homework", "news"]), sub("2", "anya", ["homework"]), sub("3", "oleg", ["news", "polls"])];
  deepStrictEqual(ids(pickTargets(subs, { topic: "homework", exceptUserId: "max" })), ["2"]);
});

test("анонимный вопрос уходит всем, включая спросившего", () => {
  const subs = [sub("1", "max", ["questions"]), sub("2", "anya", ["questions"])];
  deepStrictEqual(ids(pickTargets(subs, { topic: "questions", exceptUserId: null })), ["1", "2"]);
});

test("404 и 410 — подписки больше нет", () => {
  deepStrictEqual([404, 410].map(classifyPushStatus), ["gone", "gone"]);
});

test("429 и 5xx — временная беда push-сервиса, подписку не трогаем", () => {
  deepStrictEqual([429, 500, 503].map(classifyPushStatus), ["temporary", "temporary", "temporary"]);
});

test("прочие коды — считаем ошибкой подписки", () => {
  deepStrictEqual([400, 401, 403, 413].map(classifyPushStatus), ["broken", "broken", "broken", "broken"]);
});

test("ошибка web-push разбирается по statusCode, сетевой сбой — временный", () => {
  deepStrictEqual(classifyPushError(Object.assign(new Error("gone"), { statusCode: 410 })), "gone");
  deepStrictEqual(classifyPushError(new Error("ECONNRESET")), "temporary");
  deepStrictEqual(classifyPushError(undefined), "temporary");
});

test("темы из базы: чужое отбрасываем, порядок стабильный", () => {
  deepStrictEqual(normalizeTopics(["polls", "мусор", "news"]), ["news", "polls"]);
  deepStrictEqual(normalizeTopics(["polls", "homework", "news"]), ["homework", "news", "polls"]);
  deepStrictEqual(normalizeTopics(null), []);
  deepStrictEqual(normalizeTopics([]), []);
});
