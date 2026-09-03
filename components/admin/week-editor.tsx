"use client";

import { useMemo, useState, useTransition } from "react";
import { useGuardedRouter } from "@/components/features/nav-guard";
import { Ban, Check, Plus, Trash2, Undo2 } from "lucide-react";
import type { SlotTime } from "@/lib/db/schema";
import { addDaysIso, capitalize, fmtDayMonth, fmtRangeShort, fmtWeekday } from "@/lib/schedule/time";
import { KIND_LABEL, PARITY_LABEL, type LessonKind } from "@/lib/schedule/types";
import { deleteLesson, deleteWeek, setWeekStatus, toggleCancelLesson, updateWeekMeta, upsertLesson, type LessonInput } from "@/app/admin/actions/schedule";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import { ConfirmButton } from "./forms";
import { ScanRecognizer } from "./scan-recognizer";
import { cn, pluralRu } from "@/lib/utils";

type EditorLesson = {
  id: string;
  date: string;
  slot: number;
  startsAt: string;
  endsAt: string;
  subjectId: string | null;
  title: string;
  room: string | null;
  teacherName: string | null;
  kind: LessonKind;
  note: string | null;
  isCancelled: boolean;
  modifiedAfterPublish: boolean;
};

type SubjectOpt = { id: string; name: string; shortName: string | null; color: string | null; defaultTeacher: string | null; defaultRoom: string | null };

type Props = {
  week: { id: string; startsOn: string; parity: "upper" | "lower" | null; status: "draft" | "published"; semesterId: string | null };
  lessons: EditorLesson[];
  subjects: SubjectOpt[];
  semesters: { id: string; title: string }[];
  slotTimes: SlotTime[];
};

type Draft = Omit<LessonInput, "weekId"> & { id?: string; isCancelled?: boolean };

const KINDS: LessonKind[] = ["lecture", "practice", "lab", "consultation", "credit", "exam", "other"];

export function WeekEditor({ week, lessons, subjects, semesters, slotTimes }: Props) {
  const router = useGuardedRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sunday = addDaysIso(week.startsOn, 6);
  const days = useMemo(
    () => [...[0, 1, 2, 3, 4, 5].map((i) => addDaysIso(week.startsOn, i)), ...(lessons.some((l) => l.date === sunday) ? [sunday] : [])],
    [week.startsOn, lessons, sunday],
  );
  const baseSlots = slotTimes.length ? slotTimes : [1, 2, 3, 4, 5, 6].map((s) => ({ slot: s, start: "", end: "" }));
  // Пары со слотом вне сетки звонков (например, из скана) тоже должны быть видны и кликабельны.
  const extraSlots = [...new Set(lessons.map((l) => l.slot).filter((sl) => !baseSlots.some((b) => b.slot === sl)))].map((sl) => {
    const l = lessons.find((x) => x.slot === sl)!;
    return { slot: sl, start: l.startsAt, end: l.endsAt };
  });
  const slots = [...baseSlots, ...extraSlots].sort((a, b) => a.slot - b.slot);
  const published = week.status === "published";
  const activeCount = lessons.filter((l) => !l.isCancelled).length;

  const openNew = (date: string, slot: number) => {
    const st = slots.find((s) => s.slot === slot);
    setError(null);
    setDraft({ date, slot, startsAt: st?.start || "08:30", endsAt: st?.end || "10:00", subjectId: null, title: "", room: null, teacherName: null, kind: "practice", note: null });
  };
  const openEdit = (l: EditorLesson) => {
    setError(null);
    setDraft({ ...l });
  };

  const save = () => {
    if (!draft) return;
    start(async () => {
      const res = await upsertLesson({ ...draft, weekId: week.id });
      if (!res.ok) return setError(res.error);
      setDraft(null);
      router.refresh();
    });
  };

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      const res = (await fn()) as { ok?: boolean; error?: string } | undefined;
      if (res && res.ok === false) {
        setError(res.error ?? "Не удалось");
        return;
      }
      setDraft(null);
      router.refresh();
    });

  const onSubjectChange = (subjectId: string) => {
    if (!draft) return;
    const s = subjects.find((x) => x.id === subjectId) ?? null;
    setDraft({
      ...draft,
      subjectId: s?.id ?? null,
      title: s ? s.name : draft.title,
      teacherName: s?.defaultTeacher ?? draft.teacherName,
      room: s?.defaultRoom ?? draft.room,
    });
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium uppercase tracking-wide text-muted">Неделя</div>
            <h1 className="font-display text-[26px] font-bold leading-none">{fmtRangeShort(week.startsOn, addDaysIso(week.startsOn, 5))}</h1>
            <div className="mt-1.5 flex items-center gap-2 text-[13px] text-muted">
              <Badge tone={published ? "ok" : "warn"}>{published ? "опубликована" : "черновик"}</Badge>
              <span>
                {activeCount} {pluralRu(activeCount, "пара", "пары", "пар")}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {published ? (
              <ConfirmButton variant="secondary" size="sm" confirmText="Снять с публикации? Студенты перестанут видеть неделю." action={() => setWeekStatus(week.id, "draft").then(() => router.refresh())}>
                <Undo2 className="size-4" /> В черновик
              </ConfirmButton>
            ) : (
              <Button size="sm" loading={pending} onClick={() => run(() => setWeekStatus(week.id, "published"))}>
                <Check className="size-4" /> Опубликовать
              </Button>
            )}
            <ScanRecognizer weekId={week.id} hasLessons={lessons.length > 0} parity={week.parity} subjects={subjects.map((s) => ({ id: s.id, name: s.name }))} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Select
            value={week.parity ?? "none"}
            onChange={(e) => run(() => updateWeekMeta(week.id, { parity: e.target.value === "none" ? null : (e.target.value as "upper" | "lower"), semesterId: week.semesterId }))}
          >
            <option value="upper">{PARITY_LABEL.upper}</option>
            <option value="lower">{PARITY_LABEL.lower}</option>
            <option value="none">Без чётности</option>
          </Select>
          <Select value={week.semesterId ?? ""} onChange={(e) => run(() => updateWeekMeta(week.id, { parity: week.parity, semesterId: e.target.value || null }))}>
            <option value="">Семестр —</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </div>
        {published && <p className="text-[12px] text-muted">Неделя опубликована: правки видны студентам сразу и помечаются бейджем «изменение».</p>}
      </header>

      <div className="space-y-4">
        {days.map((date) => {
          const dayLessons = lessons.filter((l) => l.date === date);
          return (
            <section key={date} className="overflow-hidden rounded-lg bg-surface hairline">
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="font-display text-[15px] font-bold">
                  {capitalize(fmtWeekday(date))} <span className="font-sans text-[13px] font-medium text-muted">{fmtDayMonth(date)}</span>
                </div>
                <span className="text-[12px] text-dim">{dayLessons.filter((l) => !l.isCancelled).length || "—"}</span>
              </div>
              <ul className="divide-y divide-border border-t border-border">
                {slots.map((st) => {
                  const inSlot = dayLessons.filter((l) => l.slot === st.slot);
                  return (
                    <li key={st.slot} className="flex items-stretch">
                      <div className="flex w-14 shrink-0 flex-col items-center justify-center border-r border-border py-2 text-center tnum">
                        <span className="text-[13px] font-semibold">{st.slot}</span>
                        <span className="text-[10px] text-dim">{st.start}</span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        {inSlot.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => openEdit(l)}
                            className={cn("flex items-center gap-2 px-3 py-2 text-left active:bg-surface-2", l.isCancelled && "opacity-50")}
                          >
                            <span className="size-2 shrink-0 rounded-full" style={{ background: subjects.find((s) => s.id === l.subjectId)?.color ?? "#62626e" }} />
                            <span className="min-w-0 flex-1">
                              <span className={cn("block truncate text-[14px] font-medium", l.isCancelled && "line-through")}>{l.title}</span>
                              <span className="block truncate text-[12px] text-muted">
                                {[KIND_LABEL[l.kind], l.room, l.teacherName].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                            {l.modifiedAfterPublish && <Badge tone="warn">изм.</Badge>}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => openNew(date, st.slot)}
                          className={cn("flex items-center gap-1.5 px-3 py-2 text-[12px] text-dim active:bg-surface-2", inSlot.length ? "opacity-60" : "")}
                        >
                          <Plus className="size-3.5" /> {inSlot.length ? "ещё" : "добавить"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="pt-2">
        <ConfirmButton variant="danger" className="w-full" confirmText="Удалить неделю со всеми парами?" action={() => deleteWeek(week.id)}>
          <Trash2 className="size-4" /> Удалить неделю
        </ConfirmButton>
      </div>

      <Sheet open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? "Пара" : "Новая пара"}>
        {draft && (
          <div className="space-y-3 pb-2">
            <div className="text-[13px] text-muted">
              {capitalize(fmtWeekday(draft.date))}, {fmtDayMonth(draft.date)} · {draft.slot}-я пара
            </div>
            <Field label="Предмет">
              <Select value={draft.subjectId ?? ""} onChange={(e) => onSubjectChange(e.target.value)}>
                <option value="">Свободный текст</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Название (как в расписании)">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Математический анализ" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Вид">
                <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as LessonKind })}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k] || "Другое"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Аудитория">
                <Input value={draft.room ?? ""} onChange={(e) => setDraft({ ...draft, room: e.target.value })} placeholder="214" />
              </Field>
            </div>
            <Field label="Преподаватель">
              <Input value={draft.teacherName ?? ""} onChange={(e) => setDraft({ ...draft, teacherName: e.target.value })} placeholder="Иванова И.И." />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Пара №">
                <Input type="number" min={1} max={10} value={draft.slot} onChange={(e) => setDraft({ ...draft, slot: Number(e.target.value) || 1 })} />
              </Field>
              <Field label="Начало">
                <Input type="time" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
              </Field>
              <Field label="Конец">
                <Input type="time" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
              </Field>
            </div>
            <Field label="Заметка (замена, перенос)">
              <Textarea value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Пара перенесена в 305" className="min-h-16" />
            </Field>
            {error && <div className="text-[13px] text-danger">{error}</div>}
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" loading={pending} onClick={save}>
                Сохранить
              </Button>
              {draft.id && (
                <>
                  <Button variant="secondary" size="icon" title={draft.isCancelled ? "Вернуть" : "Отменить пару"} onClick={() => run(() => toggleCancelLesson(draft.id!))}>
                    {draft.isCancelled ? <Undo2 className="size-4" /> : <Ban className="size-4" />}
                  </Button>
                  <Button variant="danger" size="icon" title="Удалить" onClick={() => run(() => deleteLesson(draft.id!))}>
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
