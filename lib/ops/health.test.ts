import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_R2_ON_VERCEL, cronWarnings, describeBackup, latestBackupDay, planBackup, summarizeCronRun } from "./health";

test("latestBackupDay: берёт самый свежий день и игнорирует посторонние ключи", () => {
  assert.equal(latestBackupDay(["backups/2026-08-31.json.gz", "backups/2026-09-01.json.gz", "backups/readme.txt"]), "2026-09-01");
  assert.equal(latestBackupDay([]), null);
  assert.equal(latestBackupDay(["backups/"]), null);
});

test("planBackup: на Vercel без R2 бэкап не делается и это провал, локально — обычный прогон", () => {
  assert.deepEqual(planBackup({ storageKind: "local", onVercel: true }), { run: false, reason: NO_R2_ON_VERCEL, failure: true });
  assert.deepEqual(planBackup({ storageKind: "local", onVercel: false }), { run: true });
  assert.deepEqual(planBackup({ storageKind: "r2", onVercel: true }), { run: true });
  assert.deepEqual(planBackup({ storageKind: "r2", onVercel: false }), { run: true });
});

test("summarizeCronRun: пропущенный на Vercel бэкап красит прогон в красное", () => {
  const s = summarizeCronRun({ plan: planBackup({ storageKind: "local", onVercel: true }), backupError: null, failedScanDeletes: 0, failedOrphanDeletes: 0 });
  assert.equal(s.ok, false);
  assert.equal(s.error, NO_R2_ON_VERCEL);
  assert.deepEqual(s.warnings, []);
});

test("summarizeCronRun: удачный прогон без предупреждений", () => {
  const s = summarizeCronRun({ plan: { run: true }, backupError: null, failedScanDeletes: 0, failedOrphanDeletes: 0 });
  assert.deepEqual(s, { ok: true, error: null, warnings: [] });
});

test("summarizeCronRun: ошибка бэкапа важнее пропуска и попадает в error", () => {
  const s = summarizeCronRun({ plan: { run: true }, backupError: "AccessDenied", failedScanDeletes: 0, failedOrphanDeletes: 0 });
  assert.equal(s.ok, false);
  assert.equal(s.error, "Бэкап не удался: AccessDenied");
});

test("summarizeCronRun: неудалённые файлы не валят прогон, но видны в предупреждениях", () => {
  const s = summarizeCronRun({ plan: { run: true }, backupError: null, failedScanDeletes: 9, failedOrphanDeletes: 1 });
  assert.equal(s.ok, true);
  assert.equal(s.error, null);
  assert.deepEqual(s.warnings, ["Не удалено из хранилища 10 файлов (сканы: 9, сироты: 1)"]);

  const one = summarizeCronRun({ plan: { run: true }, backupError: null, failedScanDeletes: 0, failedOrphanDeletes: 1 });
  assert.deepEqual(one.warnings, ["Не удалено из хранилища 1 файл (сироты: 1)"]);

  const few = summarizeCronRun({ plan: { run: true }, backupError: null, failedScanDeletes: 2, failedOrphanDeletes: 0 });
  assert.deepEqual(few.warnings, ["Не удалено из хранилища 2 файла (сканы: 2)"]);
});

test("summarizeCronRun: непровальный пропуск бэкапа — предупреждение, прогон зелёный", () => {
  const s = summarizeCronRun({ plan: { run: false, reason: "тестовый режим", failure: false }, backupError: null, failedScanDeletes: 0, failedOrphanDeletes: 0 });
  assert.deepEqual(s, { ok: true, error: null, warnings: ["Бэкап пропущен: тестовый режим"] });
});

test("cronWarnings: читает только строки и переживает старый формат details", () => {
  assert.deepEqual(cronWarnings({ warnings: ["раз", 2, null, "два"] }), ["раз", "два"]);
  assert.deepEqual(cronWarnings({ ok: true }), []);
  assert.deepEqual(cronWarnings(null), []);
  assert.deepEqual(cronWarnings("строка"), []);
});

test("describeBackup: «нет ни одного» отличается от «N дней назад»", () => {
  assert.deepEqual(describeBackup({ lastBackupDay: null, todayIso: "2026-09-08", storageKind: "local", onVercel: true }), {
    ok: false,
    line: "Бэкапов нет ни одного: R2 не подключён, cron их не делает",
  });
  assert.equal(describeBackup({ lastBackupDay: null, todayIso: "2026-09-08", storageKind: "local", onVercel: false }).line, "Бэкапов нет ни одного (локальная папка .data/uploads)");
  assert.equal(describeBackup({ lastBackupDay: null, todayIso: "2026-09-08", storageKind: "r2", onVercel: true }).ok, false);
});

test("describeBackup: свежесть считается по календарным дням пояса группы", () => {
  const at = (day: string) => describeBackup({ lastBackupDay: day, todayIso: "2026-09-08", storageKind: "r2", onVercel: true });
  assert.deepEqual(at("2026-09-08"), { ok: true, line: "Последний бэкап сегодня" });
  assert.deepEqual(at("2026-09-07"), { ok: true, line: "Последний бэкап вчера" });
  assert.deepEqual(at("2026-09-06"), { ok: true, line: "Последний бэкап 2026-09-06, 2 дня назад" });
  assert.deepEqual(at("2026-09-05"), { ok: false, line: "Последний бэкап 2026-09-05, 3 дня назад — новых cron не кладёт" });
  assert.equal(at("2026-08-27").line, "Последний бэкап 2026-08-27, 12 дней назад — новых cron не кладёт");
  // Часы на сервере могли уехать назад: бэкап «из будущего» считаем сегодняшним, а не отрицательным.
  assert.deepEqual(at("2026-09-09"), { ok: true, line: "Последний бэкап сегодня" });
});
