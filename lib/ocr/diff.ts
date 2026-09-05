import { KIND_LABEL, type LessonKind } from "@/lib/schedule/types";
import { addDays, daysBetween } from "./draft";
import { normalizeTitle } from "./match";

/** Пара предыдущей опубликованной недели той же чётности — сравниваем с ней черновик. */
export type PrevLesson = {
  date: string;
  slot: number;
  title: string;
  subjectId: string | null;
  room: string | null;
  teacherName: string | null;
  kind: LessonKind;
  startsAt: string;
  endsAt: string;
};

export type DiffableDraft = Pick<PrevLesson, "date" | "slot" | "title" | "subjectId" | "room" | "teacherName" | "kind" | "startsAt" | "endsAt"> & { key: string; include: boolean };

export type DraftDiffStatus = { status: "new" } | { status: "same" } | { status: "changed"; changes: string[] };

export type DraftDiff = {
  /** Статус по ключу строки черновика; невключённые строки не сравниваются. */
  byKey: Record<string, DraftDiffStatus>;
  /** Пары прошлой недели (даты уже сдвинуты на текущую), которых в скане нет. */
  missing: PrevLesson[];
};

/** Даты пар прошлой недели → даты текущей: понедельник к понедельнику. */
export function shiftLessons<T extends { date: string }>(lessons: T[], fromWeekStart: string, toWeekStart: string): T[] {
  const shift = daysBetween(fromWeekStart, toWeekStart);
  return lessons.map((l) => ({ ...l, date: addDays(l.date, shift) }));
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const sameSubject = (a: { subjectId: string | null; title: string }, b: { subjectId: string | null; title: string }) =>
  (a.subjectId !== null && a.subjectId === b.subjectId) || normalizeTitle(a.title) === normalizeTitle(b.title);
const dash = (s: string | null) => s || "—";

/** Что именно поменялось между парой прошлой недели и строкой черновика — короткие русские метки для бейджа. */
export function describeChanges(prev: PrevLesson, next: DiffableDraft): string[] {
  const out: string[] = [];
  if (!sameSubject(prev, next)) out.push(`предмет: ${prev.title} → ${next.title}`);
  if (prev.kind !== next.kind) out.push(`вид: ${KIND_LABEL[prev.kind] || "—"} → ${KIND_LABEL[next.kind] || "—"}`);
  if (!same(prev.room, next.room)) out.push(`ауд.: ${dash(prev.room)} → ${dash(next.room)}`);
  if (!same(prev.teacherName, next.teacherName)) out.push(`преп.: ${dash(prev.teacherName)} → ${dash(next.teacherName)}`);
  if (prev.startsAt !== next.startsAt || prev.endsAt !== next.endsAt) out.push(`время: ${prev.startsAt}–${prev.endsAt} → ${next.startsAt}–${next.endsAt}`);
  return out;
}

/**
 * Диф черновика с прошлой неделей по ключу (дата, пара). В одной паре может быть несколько занятий (подгруппы):
 * строке черновика сопоставляется пара того же предмета, иначе первая свободная.
 */
export function diffDraft(draft: DiffableDraft[], prev: PrevLesson[]): DraftDiff {
  const pool = new Map<string, PrevLesson[]>();
  for (const p of prev) {
    const k = `${p.date}|${p.slot}`;
    pool.set(k, [...(pool.get(k) ?? []), p]);
  }
  const byKey: Record<string, DraftDiffStatus> = {};
  for (const d of draft) {
    if (!d.include) continue;
    const k = `${d.date}|${d.slot}`;
    const candidates = pool.get(k) ?? [];
    if (!candidates.length) {
      byKey[d.key] = { status: "new" };
      continue;
    }
    const idx = Math.max(0, candidates.findIndex((p) => sameSubject(p, d)));
    const [p] = candidates.splice(idx, 1);
    const changes = describeChanges(p, d);
    byKey[d.key] = changes.length ? { status: "changed", changes } : { status: "same" };
  }
  const missing = [...pool.values()].flat().sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  return { byKey, missing };
}
