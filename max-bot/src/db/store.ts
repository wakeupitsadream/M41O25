import { shortId } from "../util/ids.js";
import type { Db } from "./pool.js";

export const MODES = ["solve", "tutor", "ticket", "chat"] as const;
export type Mode = (typeof MODES)[number];
export const isMode = (v: unknown): v is Mode => typeof v === "string" && (MODES as readonly string[]).includes(v);

export type ChatRow = {
  chatId: number;
  userId: number;
  mode: Mode;
  topic: number;
  summary: string | null;
  summaryUpto: number | null;
};

export type HistoryMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  meta: Record<string, unknown>;
  createdAt: Date;
};

/** Вложение, которое ещё предстоит скачать: ссылки MAX живут достаточно долго для пачки фото. */
export type MediaRef = { kind: "image" | "audio"; url: string; mid: string; name?: string };

export type PendingSet = {
  id: string;
  chatId: number;
  media: MediaRef[];
  /** Растёт с каждым добавлением: обработчик, чьё фото было последним, и показывает кнопки. */
  seq: number;
  promptMid: string | null;
};

export type ModelState = {
  model: string;
  cooldownUntil: Date | null;
  reason: string | null;
  lastError: string | null;
  lastOkAt: Date | null;
  day: string | null;
  okCount: number;
  failCount: number;
};

const PENDING_KIND = "pending";

export type Store = ReturnType<typeof createStore>;

export function createStore(db: Db) {
  const store = {
    db,

    /** true — событие видим впервые; повторная доставка MAX вернёт false. */
    async markProcessed(key: string): Promise<boolean> {
      const { rows } = await db.query(
        `INSERT INTO processed_updates (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`,
        [key],
      );
      return rows.length === 1;
    },

    async getState<T>(key: string): Promise<T | null> {
      const { rows } = await db.query<{ value: T }>(`SELECT value FROM bot_state WHERE key = $1`, [key]);
      return rows[0]?.value ?? null;
    },

    async setState(key: string, value: unknown): Promise<void> {
      await db.query(
        `INSERT INTO bot_state (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    },

    async deleteState(key: string): Promise<void> {
      await db.query(`DELETE FROM bot_state WHERE key = $1`, [key]);
    },

    /** Атомарная запись, только если ключа ещё нет: так привязывается владелец. */
    async setStateIfAbsent(key: string, value: unknown): Promise<boolean> {
      const { rows } = await db.query(
        `INSERT INTO bot_state (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING RETURNING key`,
        [key, JSON.stringify(value)],
      );
      return rows.length === 1;
    },

    async getChat(chatId: number, userId: number): Promise<ChatRow> {
      const { rows } = await db.query<{
        chat_id: number;
        user_id: number;
        mode: string;
        topic: number;
        summary: string | null;
        summary_upto: number | null;
      }>(
        `INSERT INTO chats (chat_id, user_id) VALUES ($1, $2)
         ON CONFLICT (chat_id) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING chat_id, user_id, mode, topic, summary, summary_upto`,
        [chatId, userId],
      );
      const r = rows[0]!;
      return {
        chatId: r.chat_id,
        userId: r.user_id,
        mode: isMode(r.mode) ? r.mode : "solve",
        topic: r.topic,
        summary: r.summary,
        summaryUpto: r.summary_upto,
      };
    },

    async setMode(chatId: number, mode: Mode): Promise<void> {
      await db.query(`UPDATE chats SET mode = $2, updated_at = now() WHERE chat_id = $1`, [chatId, mode]);
    },

    async newTopic(chatId: number): Promise<number> {
      const { rows } = await db.query<{ topic: number }>(
        `UPDATE chats SET topic = topic + 1, summary = NULL, summary_upto = NULL, updated_at = now()
         WHERE chat_id = $1 RETURNING topic`,
        [chatId],
      );
      return rows[0]?.topic ?? 1;
    },

    async addMessage(
      chatId: number,
      topic: number,
      role: "user" | "assistant",
      content: string,
      meta: Record<string, unknown> = {},
    ): Promise<number> {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO messages (chat_id, topic, role, content, meta) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
        [chatId, topic, role, content, JSON.stringify(meta)],
      );
      await db.query(`UPDATE chats SET updated_at = now() WHERE chat_id = $1`, [chatId]);
      return rows[0]!.id;
    },

    /** Последние сообщения темы после границы сжатия, в хронологическом порядке. */
    async history(chatId: number, topic: number, afterId: number | null, limit: number): Promise<HistoryMessage[]> {
      const { rows } = await db.query<{
        id: number;
        role: "user" | "assistant";
        content: string;
        meta: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT id, role, content, meta, created_at FROM messages
         WHERE chat_id = $1 AND topic = $2 AND ($3::bigint IS NULL OR id > $3)
         ORDER BY id DESC LIMIT $4`,
        [chatId, topic, afterId, limit],
      );
      return rows.reverse().map((r) => ({ id: r.id, role: r.role, content: r.content, meta: r.meta, createdAt: r.created_at }));
    },

    async countAfter(chatId: number, topic: number, afterId: number | null): Promise<number> {
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM messages WHERE chat_id = $1 AND topic = $2 AND ($3::bigint IS NULL OR id > $3)`,
        [chatId, topic, afterId],
      );
      return rows[0]?.n ?? 0;
    },

    /** Резюме пишется, только если тема не сменилась, пока модель его готовила. */
    async setSummary(chatId: number, topic: number, summary: string, upto: number): Promise<boolean> {
      const { rowCount } = await db.query(
        `UPDATE chats SET summary = $3, summary_upto = $4 WHERE chat_id = $1 AND topic = $2
         AND (summary_upto IS NULL OR summary_upto < $4)`,
        [chatId, topic, summary, upto],
      );
      return (rowCount ?? 0) > 0;
    },

    async putItem(id: string, chatId: number, kind: string, data: unknown, ttlSec: number): Promise<void> {
      await db.query(
        `INSERT INTO items (id, chat_id, kind, data, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, now() + make_interval(secs => $5))
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
        [id, chatId, kind, JSON.stringify(data), ttlSec],
      );
    },

    async getItem<T>(id: string, kind: string): Promise<T | null> {
      const { rows } = await db.query<{ data: T }>(
        `SELECT data FROM items WHERE id = $1 AND kind = $2 AND expires_at > now()`,
        [id, kind],
      );
      return rows[0]?.data ?? null;
    },

    async takeItem<T>(id: string, kind: string): Promise<T | null> {
      const { rows } = await db.query<{ data: T }>(
        `DELETE FROM items WHERE id = $1 AND kind = $2 AND expires_at > now() RETURNING data`,
        [id, kind],
      );
      return rows[0]?.data ?? null;
    },

    async deleteItem(id: string): Promise<void> {
      await db.query(`DELETE FROM items WHERE id = $1`, [id]);
    },

    /** Счётчик с окном: число попыток подбора кода владельца и т. п. */
    async bump(id: string, chatId: number, ttlSec: number): Promise<number> {
      const { rows } = await db.query<{ n: number }>(
        `INSERT INTO items (id, chat_id, kind, data, expires_at)
         VALUES ($1, $2, 'counter', '{"n":1}'::jsonb, now() + make_interval(secs => $3))
         ON CONFLICT (id) DO UPDATE SET
           data = CASE WHEN items.expires_at > now()
                       THEN jsonb_build_object('n', (items.data->>'n')::int + 1) ELSE '{"n":1}'::jsonb END,
           expires_at = CASE WHEN items.expires_at > now() THEN items.expires_at ELSE EXCLUDED.expires_at END
         RETURNING (data->>'n')::int AS n`,
        [id, chatId, ttlSec],
      );
      return rows[0]!.n;
    },

    /** Короткая блокировка от двойного нажатия кнопки: true — захватили. */
    async tryLock(id: string, ttlSec: number): Promise<boolean> {
      const { rows } = await db.query(
        `INSERT INTO items (id, chat_id, kind, data, expires_at)
         VALUES ($1, 0, 'lock', '{}'::jsonb, now() + make_interval(secs => $2))
         ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at WHERE items.expires_at <= now()
         RETURNING id`,
        [id, ttlSec],
      );
      return rows.length === 1;
    },

    /**
     * Добавляет фото к пачке, ждущей команды. Advisory-блокировка на чат: два фото, пришедшие одновременно,
     * попадают в одну пачку, а не создают две.
     */
    async appendPending(chatId: number, media: MediaRef[], ttlSec: number): Promise<PendingSet> {
      return db.tx(async (q) => {
        await q.query(`SELECT pg_advisory_xact_lock(hashtext('pending:' || $1::text))`, [chatId]);
        const { rows } = await q.query<{ id: string; data: { media: MediaRef[]; seq: number; promptMid: string | null } }>(
          `SELECT id, data FROM items WHERE chat_id = $1 AND kind = $2 AND expires_at > now() LIMIT 1`,
          [chatId, PENDING_KIND],
        );
        const existing = rows[0];
        const id = existing?.id ?? shortId();
        const data = {
          media: [...(existing?.data.media ?? []), ...media],
          seq: (existing?.data.seq ?? 0) + 1,
          promptMid: existing?.data.promptMid ?? null,
        };
        if (!existing) await q.query(`DELETE FROM items WHERE chat_id = $1 AND kind = $2`, [chatId, PENDING_KIND]);
        await q.query(
          `INSERT INTO items (id, chat_id, kind, data, expires_at)
           VALUES ($1, $2, $3, $4::jsonb, now() + make_interval(secs => $5))
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
          [id, chatId, PENDING_KIND, JSON.stringify(data), ttlSec],
        );
        return { id, chatId, ...data };
      });
    },

    async getPending(chatId: number): Promise<PendingSet | null> {
      const { rows } = await db.query<{ id: string; data: { media: MediaRef[]; seq: number; promptMid: string | null } }>(
        `SELECT id, data FROM items WHERE chat_id = $1 AND kind = $2 AND expires_at > now() LIMIT 1`,
        [chatId, PENDING_KIND],
      );
      const r = rows[0];
      return r ? { id: r.id, chatId, ...r.data } : null;
    },

    /** Под той же блокировкой, что appendPending: иначе параллельное добавление фото затёрло бы promptMid. */
    async setPendingPrompt(chatId: number, id: string, promptMid: string): Promise<void> {
      await db.tx(async (q) => {
        await q.query(`SELECT pg_advisory_xact_lock(hashtext('pending:' || $1::text))`, [chatId]);
        await q.query(
          `UPDATE items SET data = jsonb_set(data, '{promptMid}', to_jsonb($2::text)) WHERE id = $1 AND kind = $3`,
          [id, promptMid, PENDING_KIND],
        );
      });
    },

    /** Забирает пачку целиком (по id или последнюю в чате): второй обработчик получит null. */
    async takePending(chatId: number, id?: string): Promise<PendingSet | null> {
      const { rows } = await db.query<{ id: string; data: { media: MediaRef[]; seq: number; promptMid: string | null } }>(
        `DELETE FROM items WHERE chat_id = $1 AND kind = $2 AND expires_at > now() AND ($3::text IS NULL OR id = $3)
         RETURNING id, data`,
        [chatId, PENDING_KIND, id ?? null],
      );
      const r = rows[0];
      return r ? { id: r.id, chatId, ...r.data } : null;
    },

    async modelStates(): Promise<Map<string, ModelState>> {
      const { rows } = await db.query<{
        model: string;
        cooldown_until: Date | null;
        reason: string | null;
        last_error: string | null;
        last_ok_at: Date | null;
        day: string | null;
        ok_count: number;
        fail_count: number;
      }>(`SELECT model, cooldown_until, reason, last_error, last_ok_at, day::text AS day, ok_count, fail_count FROM model_state`);
      return new Map(
        rows.map((r) => [
          r.model,
          {
            model: r.model,
            cooldownUntil: r.cooldown_until,
            reason: r.reason,
            lastError: r.last_error,
            lastOkAt: r.last_ok_at,
            day: r.day,
            okCount: r.ok_count,
            failCount: r.fail_count,
          },
        ]),
      );
    },

    /** Итог попытки модели: счётчики за день (по Екатеринбургу) и, при сбое, пауза до cooldownUntil. */
    async recordModel(
      model: string,
      day: string,
      result: { ok: true } | { ok: false; cooldownUntil: Date | null; reason: string; error: string },
    ): Promise<void> {
      if (result.ok) {
        await db.query(
          `INSERT INTO model_state (model, day, ok_count, last_ok_at, cooldown_until, reason)
           VALUES ($1, $2::date, 1, now(), NULL, NULL)
           ON CONFLICT (model) DO UPDATE SET
             ok_count = CASE WHEN model_state.day = $2::date THEN model_state.ok_count + 1 ELSE 1 END,
             fail_count = CASE WHEN model_state.day = $2::date THEN model_state.fail_count ELSE 0 END,
             day = $2::date, last_ok_at = now(), cooldown_until = NULL, reason = NULL, updated_at = now()`,
          [model, day],
        );
        return;
      }
      await db.query(
        `INSERT INTO model_state (model, day, fail_count, cooldown_until, reason, last_error)
         VALUES ($1, $2::date, 1, $3, $4, $5)
         ON CONFLICT (model) DO UPDATE SET
           fail_count = CASE WHEN model_state.day = $2::date THEN model_state.fail_count + 1 ELSE 1 END,
           ok_count = CASE WHEN model_state.day = $2::date THEN model_state.ok_count ELSE 0 END,
           day = $2::date, cooldown_until = $3, reason = $4, last_error = $5, updated_at = now()`,
        [model, day, result.cooldownUntil, result.reason, result.error.slice(0, 500)],
      );
    },

    async cleanup(): Promise<void> {
      await db.query(`DELETE FROM processed_updates WHERE created_at < now() - interval '7 days'`);
      await db.query(`DELETE FROM items WHERE expires_at < now()`);
      await db.query(`DELETE FROM messages WHERE created_at < now() - interval '180 days'`);
    },
  };
  return store;
}
