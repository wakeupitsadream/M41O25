/**
 * Непрочитанное по вкладкам таб-бара. Чистая логика без БД: одна и та же на сервере (лэйаут считает
 * время последнего события по секциям) и на клиенте (TabBar сравнивает его с тем, когда вкладку открывали).
 * Новых колонок нет: «когда я открывал вкладку» живёт в localStorage телефона, а `feed_seen_at` — общий пол:
 * открыл «Что нового» — увидел всё, точки гаснут на всех вкладках и на других устройствах.
 */

export type Section = "hw" | "schedule" | "group";
export const SECTIONS: readonly Section[] = ["hw", "schedule", "group"];

/** Время последнего чужого события по секции (ISO). Секции без событий отсутствуют. */
export type SectionLatest = Partial<Record<Section, string>>;

const BY_EVENT: Record<string, Section> = {
  hw_added: "hw",
  hw_edit_added: "hw",
  comment_added: "hw",
  schedule_published: "schedule",
  schedule_changed: "schedule",
  lesson_cancelled: "schedule",
  lesson_restored: "schedule",
  news_added: "group",
  task_added: "group",
  poll_created: "group",
  anon_question: "group",
  anon_answered: "group",
  contact_added: "group",
  birthday: "group",
};

const BY_ENTITY: Record<string, Section> = {
  homework: "hw",
  hw_edit: "hw",
  comment: "hw",
  week: "schedule",
  lesson: "schedule",
  news: "group",
  task: "group",
  poll: "group",
  anon_question: "group",
  contact: "group",
  user: "group",
};

/** Секция события ленты: сначала по типу события, для незнакомых типов — по сущности. */
export function sectionOf(eventType: string, entityType: string): Section | null {
  return BY_EVENT[eventType] ?? BY_ENTITY[entityType] ?? null;
}

/** Секция по пути страницы: `/hw/...` → hw, `/s/...` → schedule, `/group/...` → group. */
export function sectionOfPath(pathname: string): Section | null {
  if (/^\/hw(\/|$)/.test(pathname)) return "hw";
  if (/^\/s(\/|$)/.test(pathname)) return "schedule";
  if (/^\/group(\/|$)/.test(pathname)) return "group";
  return null;
}

/** Из строк «тип события, сущность, время последнего» собирает время последнего события по секциям. */
export function latestBySection(rows: { eventType: string; entityType: string; latest: Date | string }[]): SectionLatest {
  const out: SectionLatest = {};
  for (const r of rows) {
    const s = sectionOf(r.eventType, r.entityType);
    if (!s) continue;
    const iso = typeof r.latest === "string" ? r.latest : r.latest.toISOString();
    if (!out[s] || isNewer(iso, out[s])) out[s] = iso;
  }
  return out;
}

/** `a` строго позже `b`; пустое или битое значение считается «никогда». */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = toMs(a);
  const tb = toMs(b);
  if (ta === null) return false;
  if (tb === null) return true;
  return ta > tb;
}

export function toMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * Где рисовать точку: последнее событие секции новее и localStorage-отметки вкладки, и `feed_seen_at`.
 * Активную секцию не показываем — она сейчас перед глазами.
 */
export function unreadSections(latest: SectionLatest, seen: Partial<Record<Section, string | null>>, feedSeenAt: string | null, active: Section | null = null): Section[] {
  return SECTIONS.filter((s) => s !== active && isNewer(latest[s], seen[s]) && isNewer(latest[s], feedSeenAt));
}

export const tabSeenKey = (s: Section) => `raspison.tab.seen.${s}`;
