/**
 * Что входит в дамп и в каком порядке восстанавливается (внешние ключи: родители раньше детей).
 * Один список на lib/backup.ts и scripts/restore.ts: раньше это были два ручных списка, и push_subscriptions
 * потерялась из обоих молча. Тест lib/backup-tables.test.ts сверяет список со схемой: новая таблица обязана
 * попасть либо сюда, либо в BACKUP_EXCLUDED с причиной.
 */
export const BACKUP_TABLES = [
  "groups",
  "users",
  "push_subscriptions",
  "semesters",
  "subjects",
  "weeks",
  "lessons",
  "schedule_imports",
  "homework",
  "hw_edits",
  "hw_done",
  "comments",
  "attachments",
  "news",
  "tasks",
  "task_checks",
  "polls",
  "poll_options",
  "poll_votes",
  "contacts",
  "anon_questions",
  "reactions",
  "activity",
  // Помощник: доступ, платежи (из них выручка), беседы и сообщения.
  "assistant_access",
  "assistant_payments",
  "assistant_conversations",
  "assistant_messages",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

/** Служебное, что в дамп не идёт намеренно — с причиной, чтобы тест полноты не считал это пропуском. */
export const BACKUP_EXCLUDED: Record<string, string> = {
  device_sessions: "сессии устройств: после восстановления все входят заново (PIN тоже не бэкапится)",
  auth_attempts: "счётчики попыток входа за сутки",
  anon_quota: "квоты анонимных вопросов за день — связывают человека с днём вопроса",
  assistant_quota: "счётчики лимитов помощника за две недели",
  app_errors: "журнал ошибок, живёт 30 дней",
  cron_runs: "журнал прогонов cron",
};

/** Колонки-массивы Postgres (text[]): pg сериализует их сам, а JSON.stringify дал бы `["a"]` вместо `{a}`. Остальные объекты — jsonb. */
export const BACKUP_ARRAY_COLUMNS = new Set(["subjects.aliases", "push_subscriptions.topics"]);
