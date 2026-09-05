import { test } from "node:test";
import assert from "node:assert/strict";
import { FEED_PAGE, nextPageHref, olderLimit, parseFeedParams } from "./feed-page";

const seen = new Date("2026-09-05T10:00:00Z");

test("parseFeedParams: без параметров порог = feed_seen_at, порций 0", () => {
  assert.deepEqual(parseFeedParams({}, seen), { since: seen, pages: 0 });
  assert.deepEqual(parseFeedParams({}, null), { since: null, pages: 0 });
});

test("parseFeedParams: since из URL принимается только если не позже feed_seen_at", () => {
  const earlier = seen.getTime() - 60_000;
  assert.equal(parseFeedParams({ since: String(earlier) }, seen).since?.getTime(), earlier);
  // Порог «из будущего» спрятал бы непрочитанное — игнорируем.
  assert.equal(parseFeedParams({ since: String(seen.getTime() + 60_000) }, seen).since?.getTime(), seen.getTime());
  // Ленту ещё не открывали: любой порог из URL годится (он мог прийти от первого показа).
  assert.equal(parseFeedParams({ since: String(earlier) }, null).since?.getTime(), earlier);
  // Мусор — как будто параметра нет.
  assert.equal(parseFeedParams({ since: "abc" }, seen).since, seen);
  assert.equal(parseFeedParams({ since: "-5" }, seen).since, seen);
});

test("parseFeedParams: more ограничен и не отрицателен", () => {
  assert.equal(parseFeedParams({ more: "2" }, seen).pages, 2);
  assert.equal(parseFeedParams({ more: "999" }, seen).pages, 200);
  assert.equal(parseFeedParams({ more: "x" }, seen).pages, 0);
});

test("nextPageHref фиксирует порог и увеличивает more; olderLimit растёт порциями", () => {
  assert.equal(nextPageHref("/group/feed", { since: seen, pages: 0 }), `/group/feed?since=${seen.getTime()}&more=1`);
  assert.equal(nextPageHref("/group/feed", { since: null, pages: 3 }), "/group/feed?more=4");
  assert.equal(olderLimit(0), FEED_PAGE);
  assert.equal(olderLimit(2), FEED_PAGE * 3);
});
