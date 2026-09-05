import { test } from "node:test";
import assert from "node:assert/strict";
import { isNewer, latestBySection, sectionOf, sectionOfPath, unreadSections } from "./unread";

test("sectionOf: тип события решает, незнакомый тип — по сущности, совсем незнакомое — null", () => {
  assert.equal(sectionOf("hw_added", "homework"), "hw");
  assert.equal(sectionOf("comment_added", "homework"), "hw");
  assert.equal(sectionOf("schedule_published", "week"), "schedule");
  assert.equal(sectionOf("lesson_cancelled", "lesson"), "schedule");
  assert.equal(sectionOf("news_added", "news"), "group");
  assert.equal(sectionOf("task_added", "task"), "group");
  assert.equal(sectionOf("anon_question", "anon_question"), "group");
  assert.equal(sectionOf("something_new", "poll"), "group");
  assert.equal(sectionOf("something_new", "lesson"), "schedule");
  assert.equal(sectionOf("something_new", "unknown"), null);
});

test("sectionOfPath: только корни вкладок, /me и /admin ни к чему", () => {
  assert.equal(sectionOfPath("/hw"), "hw");
  assert.equal(sectionOfPath("/hw/abc"), "hw");
  assert.equal(sectionOfPath("/s"), "schedule");
  assert.equal(sectionOfPath("/s/d/2026-09-05"), "schedule");
  assert.equal(sectionOfPath("/group/feed"), "group");
  assert.equal(sectionOfPath("/me"), null);
  assert.equal(sectionOfPath("/schedule"), null);
});

test("latestBySection: берёт максимум по секции, пропускает незнакомое", () => {
  const latest = latestBySection([
    { eventType: "hw_added", entityType: "homework", latest: new Date("2026-09-01T10:00:00Z") },
    { eventType: "comment_added", entityType: "homework", latest: "2026-09-03T10:00:00.000Z" },
    { eventType: "news_added", entityType: "news", latest: new Date("2026-09-02T10:00:00Z") },
    { eventType: "weird", entityType: "weird", latest: new Date("2026-09-04T10:00:00Z") },
  ]);
  assert.deepEqual(latest, { hw: "2026-09-03T10:00:00.000Z", group: "2026-09-02T10:00:00.000Z" });
});

test("isNewer: пустое и битое — «никогда»", () => {
  assert.equal(isNewer("2026-09-02T00:00:00Z", "2026-09-01T00:00:00Z"), true);
  assert.equal(isNewer("2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"), false);
  assert.equal(isNewer("2026-09-01T00:00:00Z", null), true);
  assert.equal(isNewer("2026-09-01T00:00:00Z", "мусор"), true);
  assert.equal(isNewer(undefined, "2026-09-01T00:00:00Z"), false);
  assert.equal(isNewer(null, null), false);
});

test("unreadSections: точка, если событие новее и отметки вкладки, и feed_seen_at; активную не показываем", () => {
  const latest = { hw: "2026-09-05T08:00:00Z", schedule: "2026-09-04T08:00:00Z", group: "2026-09-03T08:00:00Z" };
  // Ничего не открывал, ленту не смотрел — везде точки.
  assert.deepEqual(unreadSections(latest, {}, null), ["hw", "schedule", "group"]);
  // Открывал ДЗ после события — точки на ДЗ нет.
  assert.deepEqual(unreadSections(latest, { hw: "2026-09-05T09:00:00Z" }, null), ["schedule", "group"]);
  // Смотрел «Что нового» 4-го вечером — гаснет всё, что раньше, даже без localStorage (новый телефон).
  assert.deepEqual(unreadSections(latest, {}, "2026-09-04T20:00:00Z"), ["hw"]);
  // Стою на вкладке ДЗ — на ней точку не рисуем.
  assert.deepEqual(unreadSections(latest, {}, null, "hw"), ["schedule", "group"]);
  // Секций без событий нет.
  assert.deepEqual(unreadSections({ group: "2026-09-03T08:00:00Z" }, {}, null), ["group"]);
});
