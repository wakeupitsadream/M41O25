/**
 * Порционная лента «Что нового»: всё непрочитанное целиком, ниже — старое страницами по FEED_PAGE.
 * Порог «непрочитанного» после первого показа фиксируется в URL (`since`), иначе после `markFeedSeen`
 * следующая порция считала бы новое уже прочитанным и список бы схлопнулся.
 */

export const FEED_PAGE = 30;
/** Потолок на «всё непрочитанное» — защита от бесконечной страницы у того, кто не заходил полгода. */
export const FEED_FRESH_CAP = 300;

export type FeedParams = { since: Date | null; pages: number };

/** `since` — миллисекунды порога (только из наших же ссылок), `more` — сколько порций старого показать. */
export function parseFeedParams(sp: { since?: string; more?: string }, feedSeenAt: Date | null): FeedParams {
  let since = feedSeenAt;
  if (sp.since && /^\d{1,15}$/.test(sp.since)) {
    const ms = Number(sp.since);
    // Порог из URL не может быть позже фактического feed_seen_at: иначе можно спрятать новое, которого ты не видел.
    if (feedSeenAt === null || ms <= feedSeenAt.getTime()) since = new Date(ms);
  }
  const n = sp.more && /^\d{1,3}$/.test(sp.more) ? Number(sp.more) : 0;
  return { since, pages: Math.min(Math.max(n, 0), 200) };
}

/** Ссылка на следующую порцию: порог фиксируем, счётчик порций +1. */
export function nextPageHref(base: string, p: FeedParams): string {
  const q = new URLSearchParams();
  if (p.since) q.set("since", String(p.since.getTime()));
  q.set("more", String(p.pages + 1));
  return `${base}?${q}`;
}

/** Сколько старых событий показывать на этой странице. */
export const olderLimit = (pages: number) => FEED_PAGE * (pages + 1);
