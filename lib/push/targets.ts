import type { PushTopic } from "@/lib/push/topics";

export type PushTarget = { id: string; userId: string; endpoint: string; p256dh: string; auth: string; topics: string[] };

/**
 * Кому слать: подписки на нужную тему, кроме автора самого действия — человеку не сообщают о том, что он только что
 * сделал сам. У анонимного вопроса автора нет, там exceptUserId = null: иначе по «кому не пришло» вычислили бы, кто спросил.
 */
export function pickTargets<T extends PushTarget>(subs: readonly T[], opts: { topic: PushTopic; exceptUserId?: string | null }): T[] {
  return subs.filter((s) => s.userId !== opts.exceptUserId && s.topics.includes(opts.topic));
}
