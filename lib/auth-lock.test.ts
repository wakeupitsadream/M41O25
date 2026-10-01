import { test } from "node:test";
import assert from "node:assert/strict";
import { lockMessage, lockMinutesForFailures, lockMinutesForSeries, remainingLabel, stillLockedMessage } from "./auth-lock";

test("lockMinutesForSeries: 1 → 5 → 30 → сутки, дальше не растёт", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(lockMinutesForSeries), [1, 5, 30, 1440, 1440, 1440]);
  assert.equal(lockMinutesForSeries(0), 1);
});

test("lockMinutesForFailures: замок только на каждой пятой неудаче", () => {
  assert.equal(lockMinutesForFailures(4), null);
  assert.equal(lockMinutesForFailures(5), 1);
  assert.equal(lockMinutesForFailures(6), null);
  assert.equal(lockMinutesForFailures(10), 5);
  assert.equal(lockMinutesForFailures(15), 30);
  assert.equal(lockMinutesForFailures(20), 1440);
  assert.equal(lockMinutesForFailures(0), null);
});

test("lockMessage: минуты склоняются, сутки — «до завтра»", () => {
  assert.match(lockMessage(1), /на 1 минуту/);
  assert.match(lockMessage(5), /на 5 минут/);
  assert.match(lockMessage(30), /на 30 минут/);
  assert.match(lockMessage(1440), /до завтра/);
});

test("remainingLabel и stillLockedMessage: остаток в минутах или часах, истёкший замок — null", () => {
  const now = Date.UTC(2026, 8, 23, 10, 0, 0);
  assert.equal(remainingLabel(new Date(now + 30_000), now), "1 минуту");
  assert.equal(remainingLabel(new Date(now + 4.2 * 60_000), now), "5 минут");
  assert.equal(remainingLabel(new Date(now + 23 * 3600_000), now), "23 часа");
  assert.equal(stillLockedMessage(new Date(now - 1), now), null);
  assert.equal(stillLockedMessage(null, now), null);
  assert.match(stillLockedMessage(new Date(now + 10 * 60_000), now) ?? "", /через 10 минут/);
});
