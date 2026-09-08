import { test } from "node:test";
import assert from "node:assert/strict";
import { QUEUE_TTL_MS } from "@/lib/hw/draft";
import {
  BACKUP_KEEP,
  HOMEWORK_ORPHAN_TTL_MS,
  NO_R2_ON_VERCEL,
  ORPHAN_TTL_MS,
  cronWarnings,
  describeBackup,
  latestBackupDay,
  orphanCutoffs,
  planBackup,
  rotateBackups,
  staleBackups,
  summarizeCronRun,
} from "./health";

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
  // Два пропущенных прогона подряд — уже красное: зелёная строка здесь означала бы, что беду видно только на третьи сутки.
  assert.deepEqual(at("2026-09-06"), { ok: false, line: "Последний бэкап 2026-09-06, 2 дня назад — новых cron не кладёт" });
  assert.deepEqual(at("2026-09-05"), { ok: false, line: "Последний бэкап 2026-09-05, 3 дня назад — новых cron не кладёт" });
  assert.equal(at("2026-08-27").line, "Последний бэкап 2026-08-27, 12 дней назад — новых cron не кладёт");
  // Часы на сервере могли уехать назад: бэкап «из будущего» считаем сегодняшним, а не отрицательным.
  assert.deepEqual(at("2026-09-09"), { ok: true, line: "Последний бэкап сегодня" });
});

test("staleBackups: держим последние BACKUP_KEEP дампов, лишними становятся самые старые", () => {
  const keys = ["backups/2026-09-03.json.gz", "backups/2026-09-01.json.gz", "backups/2026-09-02.json.gz"];
  assert.deepEqual(staleBackups(keys, 2), ["backups/2026-09-01.json.gz"]);
  assert.deepEqual(staleBackups(keys, 5), []);
  assert.deepEqual(staleBackups([], 2), []);
  // Порядок исходного списка не важен и сам список не портится.
  assert.deepEqual(keys[0], "backups/2026-09-03.json.gz");
  assert.equal(BACKUP_KEEP, 30);
});

test("rotateBackups: неудачное удаление старого дампа не роняет бэкап, а считается", async () => {
  const keys = ["backups/2026-09-03.json.gz", "backups/2026-09-01.json.gz", "backups/2026-09-02.json.gz"];
  const seen: string[] = [];
  const res = await rotateBackups(
    keys,
    async (k) => {
      seen.push(k);
      return false; // R2 ответил 500 на DeleteObject
    },
    1,
  );
  assert.deepEqual(seen, ["backups/2026-09-01.json.gz", "backups/2026-09-02.json.gz"]);
  assert.deepEqual(res, { removed: 0, failed: 2 });

  // Прогон с такой ротацией остаётся зелёным: дамп за сегодня лежит, backupError не появился.
  assert.deepEqual(summarizeCronRun({ plan: { run: true }, backupError: null, failedScanDeletes: 0, failedOrphanDeletes: 0 }), {
    ok: true,
    error: null,
    warnings: [],
  });
});

test("rotateBackups: удачная ротация считает удалённые, частичная — только дошедшие", async () => {
  assert.deepEqual(await rotateBackups(["a", "b", "c"], async () => true, 1), { removed: 2, failed: 0 });
  assert.deepEqual(await rotateBackups(["a", "b", "c"], async (k) => k !== "a", 1), { removed: 1, failed: 1 });
  assert.deepEqual(await rotateBackups(["a"], async () => true, 30), { removed: 0, failed: 0 });
});

test("orphanCutoffs: вложение домашки живёт дольше офлайн-очереди, остальные сироты — сутки", () => {
  const now = Date.parse("2026-09-08T00:00:00.000Z");
  const cut = orphanCutoffs(now);
  assert.equal(cut.common.toISOString(), "2026-09-07T00:00:00.000Z");
  assert.equal(cut.homework.toISOString(), "2026-08-31T00:00:00.000Z");
  // Главное свойство: фото, приложенное к записи, которая всю неделю ждёт сети в очереди, cron не заберёт.
  const oldestLivingQueueEntry = now - QUEUE_TTL_MS;
  assert.ok(cut.homework.getTime() < oldestLivingQueueEntry, "окно домашки должно перекрывать всю жизнь очереди");
  assert.equal(HOMEWORK_ORPHAN_TTL_MS, QUEUE_TTL_MS + ORPHAN_TTL_MS);
  // Сутки для остальных не трогали: брошенные крестиком файлы новостей и задач по-прежнему уходят на следующий день.
  assert.ok(cut.common.getTime() > oldestLivingQueueEntry);
});
