import { QUEUE_TTL_MS } from "@/lib/hw/draft";
import { pluralRu } from "@/lib/utils";

/**
 * Чистая логика эксплуатации: решение «делать ли бэкап», честный итог ночного прогона и текст про бэкапы
 * для карточки «Диагностика». Ни базы, ни сети — это проверяется тестами, а не чтением логов после факта.
 */

export type StorageKind = "r2" | "local";

/** Что делать с бэкапом в этом прогоне. failure — пропуск считается провалом, сторож должен покраснеть. */
export type BackupPlan = { run: true } | { run: false; reason: string; failure: boolean };

export const NO_R2_ON_VERCEL = "R2 не подключён — бэкап складывать некуда: на Vercel постоянного диска нет";

/**
 * На Vercel без R2 бэкапа не существует: локальная папка живёт до конца запроса. Это молчаливая потеря данных,
 * поэтому пропуск здесь — провал прогона. Локальная разработка кладёт дамп на диск и краснеть не должна.
 */
export function planBackup(input: { storageKind: StorageKind; onVercel: boolean }): BackupPlan {
  if (input.storageKind === "local" && input.onVercel) return { run: false, reason: NO_R2_ON_VERCEL, failure: true };
  return { run: true };
}

/** Итог прогона: ok для healthchecks и cron_runs, причина падения и предупреждения (прогон не валят, но видны). */
export type CronSummary = { ok: boolean; error: string | null; warnings: string[] };

export function summarizeCronRun(input: {
  plan: BackupPlan;
  backupError: string | null;
  failedScanDeletes: number;
  failedOrphanDeletes: number;
}): CronSummary {
  const warnings: string[] = [];
  let error: string | null = null;

  if (input.backupError) error = `Бэкап не удался: ${input.backupError}`;
  else if (!input.plan.run) {
    if (input.plan.failure) error = input.plan.reason;
    else warnings.push(`Бэкап пропущен: ${input.plan.reason}`);
  }

  const files = input.failedScanDeletes + input.failedOrphanDeletes;
  if (files > 0) {
    const parts = [
      input.failedScanDeletes > 0 ? `сканы: ${input.failedScanDeletes}` : null,
      input.failedOrphanDeletes > 0 ? `сироты: ${input.failedOrphanDeletes}` : null,
    ].filter(Boolean);
    warnings.push(`Не удалено из хранилища ${files} ${pluralRu(files, "файл", "файла", "файлов")} (${parts.join(", ")})`);
  }

  return { ok: error === null, error, warnings };
}

/** Предупреждения из details последнего прогона (jsonb, формат мог быть старым — читаем осторожно). */
export function cronWarnings(details: unknown): string[] {
  if (typeof details !== "object" || details === null) return [];
  const raw = (details as { warnings?: unknown }).warnings;
  return Array.isArray(raw) ? raw.filter((w): w is string => typeof w === "string") : [];
}

/** Самый свежий день из ключей хранилища вида backups/YYYY-MM-DD.json.gz (имена сортируются как даты). */
export function latestBackupDay(keys: string[]): string | null {
  const days = keys.map((k) => /(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(k)?.[1]).filter((d): d is string => Boolean(d));
  return days.sort().at(-1) ?? null;
}

/** Строка «Диагностики» про бэкапы: «их нет вообще» и «последний N дней назад» — разные беды. */
export type BackupState = { ok: boolean; line: string };

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export function describeBackup(input: { lastBackupDay: string | null; todayIso: string; storageKind: StorageKind; onVercel: boolean }): BackupState {
  if (!input.lastBackupDay) {
    if (input.storageKind === "local" && input.onVercel) return { ok: false, line: "Бэкапов нет ни одного: R2 не подключён, cron их не делает" };
    if (input.storageKind === "local") return { ok: false, line: "Бэкапов нет ни одного (локальная папка .data/uploads)" };
    return { ok: false, line: "Бэкапов нет ни одного — R2 подключён, но cron ещё ничего не положил" };
  }
  const days = Math.max(0, dayNumber(input.todayIso) - dayNumber(input.lastBackupDay));
  if (days === 0) return { ok: true, line: "Последний бэкап сегодня" };
  if (days === 1) return { ok: true, line: "Последний бэкап вчера" };
  // Дальше «вчера» зелёного не бывает: два пропущенных прогона подряд — это уже потеря, а не задержка.
  const age = `${days} ${pluralRu(days, "день", "дня", "дней")} назад`;
  return { ok: false, line: `Последний бэкап ${input.lastBackupDay}, ${age} — новых cron не кладёт` };
}

/* ─── Ротация бэкапов ──────────────────────────────────────────────────────── */

/** Сколько дампов держим в хранилище. */
export const BACKUP_KEEP = 30;

/** Лишние дампы: имена backups/YYYY-MM-DD.json.gz сортируются как даты, поэтому в утиль уходит начало списка. */
export const staleBackups = (keys: string[], keep = BACKUP_KEEP) => {
  const sorted = [...keys].sort();
  return sorted.slice(0, Math.max(0, sorted.length - keep));
};

/**
 * Ротация старых дампов. К этому моменту сегодняшний бэкап уже лежит в хранилище, поэтому упавший
 * DeleteObject (транзиентные 500 и SlowDown у R2 — обычное дело) не значит «бэкапа за сегодня нет»:
 * считаем неудачи и идём дальше, а не роняем весь прогон и не будим админа письмом в четыре утра.
 * `remove` возвращает признак успеха и сам не бросает (см. deleteFile в app/api/cron/daily/route.ts).
 */
export async function rotateBackups(keys: string[], remove: (key: string) => Promise<boolean>, keep = BACKUP_KEEP) {
  const stale = staleBackups(keys, keep);
  let failed = 0;
  for (const k of stale) if (!(await remove(k))) failed += 1;
  return { removed: stale.length - failed, failed };
}

/* ─── Сироты-вложения ──────────────────────────────────────────────────────── */

/** Файл без записи — обычно брошенный крестиком в форме: сутки на «передумал» и в утиль. */
export const ORPHAN_TTL_MS = 24 * 3600_000;

/**
 * Вложение домашки — исключение. Пока сети нет, запись ждёт в офлайн-очереди на телефоне (lib/hw/draft.ts),
 * а файлы привяжутся к ней только при успешной отправке — до тех пор они лежат сиротами с entity_id = null.
 * Чистить их раньше, чем очередь протухнет сама (QUEUE_TTL_MS), значит стирать фото, которое человеку
 * пообещали отправить. Даём очереди дожить и сутки запаса сверху.
 */
export const HOMEWORK_ORPHAN_TTL_MS = QUEUE_TTL_MS + ORPHAN_TTL_MS;

/** Границы «старше чего чистим» для сирот-вложений: общая и отдельная для домашки. */
export function orphanCutoffs(now: number) {
  return { common: new Date(now - ORPHAN_TTL_MS), homework: new Date(now - HOMEWORK_ORPHAN_TTL_MS) };
}
