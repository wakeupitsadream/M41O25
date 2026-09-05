"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useGuardedRouter } from "@/components/features/nav-guard";
import { AlertTriangle, Check, Pencil, ScanLine, Sparkles, Wand2 } from "lucide-react";
import type { DraftLesson } from "@/lib/ocr/draft";
import { diffDraft, type PrevLesson } from "@/lib/ocr/diff";
import type { ApplyMode } from "@/lib/ocr/apply";
import { applyDraft } from "@/app/admin/actions/import";
import { capitalize, fmtDayMonth, fmtWeekday } from "@/lib/schedule/time";
import { KIND_LABEL, type LessonKind } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import { AttachmentUploader, type UploadedFile } from "@/components/hw/attachment-uploader";
import { cn, pluralRu } from "@/lib/utils";

type SubjectOpt = { id: string; name: string; shortName: string | null; defaultTeacher: string | null; defaultRoom: string | null };

type Previous = { weekId: string; startsOn: string; parity: "upper" | "lower" | null; lessons: PrevLesson[] };

type Recognized = {
  importId: string;
  model: string;
  attempts: number;
  groupFound: boolean;
  groupLabel: string | null;
  weekType: "upper" | "lower" | null;
  notes: string;
  draft: DraftLesson[];
  previous?: Previous | null;
  durationMs?: number;
  schemaFallback?: boolean;
};

const PARITY_LABEL = { upper: "верхняя", lower: "нижняя" } as const;
const KINDS: LessonKind[] = ["lecture", "practice", "lab", "consultation", "credit", "exam", "other"];

/**
 * Субботний ритуал: загрузил 1–3 фото скана → распознали только нашу группу → проверил, поправил тапом → применил в неделю.
 * Отказ Polza никогда не блокирует: тот же редактор заполняется руками.
 */
export function ScanRecognizer({ weekId, hasLessons, subjects, parity = null }: { weekId: string; hasLessons: boolean; subjects: SubjectOpt[]; parity?: "upper" | "lower" | null }) {
  const router = useGuardedRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState<null | "fast" | "strong">(null);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<Recognized | null>(null);
  const [edit, setEdit] = useState<DraftLesson | null>(null);
  // По умолчанию — полная замена, как раньше; «добавить только новые» выбирается явно.
  const [mode, setMode] = useState<ApplyMode>("replace");
  const [pending, start] = useTransition();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const recognize = async (strong: boolean) => {
    setError(null);
    setBusy(strong ? "strong" : "fast");
    // Сервер живёт до 120 с; клиент ждёт 110, чтобы показать понятную ошибку, а не вечный спиннер.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 110_000);
    try {
      const res = await fetch("/api/admin/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId, attachmentIds: files.map((f) => f.id), strong }),
        signal: ctrl.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Не удалось распознать");
      setRec(json as Recognized);
      setMode("replace");
    } catch (e) {
      setError(e instanceof Error && e.name === "AbortError" ? "Модель не ответила за 110 секунд — попробуй одно фото или сильную модель" : e instanceof Error ? e.message : "Не удалось распознать");
    } finally {
      clearTimeout(timer);
      setBusy(null);
    }
  };

  const patch = (key: string, fn: (d: DraftLesson) => DraftLesson) => rec && setRec({ ...rec, draft: rec.draft.map((d) => (d.key === key ? fn(d) : d)) });
  const toggle = (key: string) => patch(key, (d) => ({ ...d, include: !d.include }));
  const included = rec?.draft.filter((d) => d.include) ?? [];
  const uncertainCount = included.filter((d) => d.uncertain).length;
  const fuzzyCount = included.filter((d) => d.matchKind === "fuzzy").length;
  const hiddenByParity = rec?.draft.filter((d) => !d.include && d.weekType !== "both").length ?? 0;
  const parityMismatch = Boolean(rec?.weekType && parity && rec.weekType !== parity);
  const parityUnknown = parity === null && (rec?.draft.some((d) => d.weekType !== "both") ?? false);
  const diff = useMemo(() => (rec?.previous ? diffDraft(rec.draft, rec.previous.lessons) : null), [rec]);
  const subjectName = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? null;

  const apply = () => {
    if (!rec) return;
    if (parityUnknown) return setError("На скане есть пары только верхней или нижней недели, а у этой недели чётность не указана. Укажи её в шапке редактора и распознай ещё раз.");
    const effectiveMode: ApplyMode = hasLessons ? mode : "replace";
    if (hasLessons && effectiveMode === "replace" && !window.confirm("В неделе уже есть пары. Заменить их распознанными?")) return;
    start(async () => {
      const res = await applyDraft(
        weekId,
        rec.importId,
        included.map((d) => ({ date: d.date, slot: d.slot, startsAt: d.startsAt, endsAt: d.endsAt, title: d.title, scanTitle: d.scanTitle, subjectId: d.subjectId, room: d.room, teacherName: d.teacherName, kind: d.kind })),
        effectiveMode,
      );
      if (!res.ok) return setError(res.error);
      setOpen(false);
      setRec(null);
      setFiles([]);
      router.refresh();
    });
  };

  /** Правка строки в шторке: выбор предмета подставляет название и пустые преподавателя/аудиторию из справочника. */
  const onEditSubject = (subjectId: string) => {
    if (!edit) return;
    const s = subjects.find((x) => x.id === subjectId) ?? null;
    setEdit({
      ...edit,
      subjectId: s?.id ?? null,
      matchKind: s ? "exact" : null,
      title: s ? s.name : edit.scanTitle,
      teacherName: edit.teacherName || (s?.defaultTeacher ?? null),
      teacherSource: edit.teacherName ? edit.teacherSource : s?.defaultTeacher ? "catalog" : null,
      room: edit.room || (s?.defaultRoom ?? null),
      roomSource: edit.room ? edit.roomSource : s?.defaultRoom ? "catalog" : null,
    });
  };
  const saveEdit = () => {
    if (!edit) return;
    if (!edit.title.trim()) return setError("Название пары не может быть пустым");
    const foreign = parity !== null && edit.weekType !== "both" && edit.weekType !== parity;
    patch(edit.key, () => ({ ...edit, title: edit.title.trim(), room: edit.room?.trim() || null, teacherName: edit.teacherName?.trim() || null, include: foreign ? false : edit.include }));
    setEdit(null);
    setError(null);
  };

  const days = [...new Set(rec?.draft.map((d) => d.date) ?? [])];
  const applyLabel = hasLessons && mode === "add-missing" ? "Применить только новые" : "Применить";

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ScanLine className="size-4" /> По скану
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Распознать скан">
        {!rec ? (
          <div className="space-y-4 pb-2">
            <p className="text-[13px] text-muted">
              Фото или скан документа со всеми группами — 1–3 изображения в порядке страниц. Сними так, чтобы столбец группы и шапка с днями и временем занимали весь кадр. Модель вытащит только нашу группу, дальше проверишь и поправишь тапом.
            </p>
            <AttachmentUploader entityType="scan" value={files} onChange={setFiles} max={3} accept="image/jpeg,image/png,image/webp" />
            {error && (
              <div className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2.5 text-[13px] text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
              </div>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={!files.length || busy !== null} loading={busy === "fast"} onClick={() => recognize(false)}>
                <Wand2 className="size-4" /> Распознать
              </Button>
              <Button variant="secondary" disabled={!files.length || busy !== null} loading={busy === "strong"} onClick={() => recognize(true)} title="Медленнее и дороже, но точнее">
                <Sparkles className="size-4" /> Сильной
              </Button>
            </div>
            {busy && (
              <p className="text-center text-[12px] text-dim">
                Обычно 20–60 секунд, до полутора минут. Не сворачивай приложение · {elapsed} с
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <Badge tone={rec.groupFound ? "ok" : "danger"}>{rec.groupFound ? "группа найдена" : "группа не найдена"}</Badge>
              {rec.groupLabel && <Badge>найдена как «{rec.groupLabel}»</Badge>}
              {rec.weekType && <Badge tone={parityMismatch ? "warn" : "neutral"}>{PARITY_LABEL[rec.weekType]} на скане</Badge>}
              <span className="text-dim">
                {rec.model}
                {rec.durationMs ? ` · ${Math.round(rec.durationMs / 1000)} с` : ""}
              </span>
            </div>
            {parityMismatch && rec.weekType && parity && (
              <p className="flex items-start gap-1.5 rounded-md bg-warn/10 px-3 py-2 text-[12px] text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> На скане {PARITY_LABEL[rec.weekType]} неделя, а эта неделя помечена как {PARITY_LABEL[parity]} — проверь чётность в шапке редактора, иначе пары уедут на другую неделю.
              </p>
            )}
            {parityUnknown && (
              <p className="flex items-start gap-1.5 rounded-md bg-warn/10 px-3 py-2 text-[12px] text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> На скане есть пары только верхней или нижней недели, а чётность этой недели не указана. Укажи её в шапке — иначе применить нельзя.
              </p>
            )}
            {hiddenByParity > 0 && <p className="text-[12px] text-dim">Скрыто {hiddenByParity} {pluralRu(hiddenByParity, "пара", "пары", "пар")} другой чётности — они относятся к соседней неделе.</p>}
            {rec.notes && <p className="rounded-md bg-surface-2 px-3 py-2 text-[12px] text-muted">{rec.notes}</p>}
            {uncertainCount > 0 && (
              <p className="flex items-center gap-1.5 text-[12px] text-warn">
                <AlertTriangle className="size-3.5" /> {uncertainCount} {pluralRu(uncertainCount, "ячейка", "ячейки", "ячеек")} под сомнением — проверь по raw-тексту
              </p>
            )}
            {fuzzyCount > 0 && <p className="text-[12px] text-muted">{fuzzyCount} {pluralRu(fuzzyCount, "предмет подобран", "предмета подобраны", "предметов подобраны")} по похожему названию (≈) — проверь и поправь тапом на карандаш. После применения написание запомнится.</p>}
            {rec.previous && (
              <p className="text-[12px] text-dim">
                Сравнение с неделей от {fmtDayMonth(rec.previous.startsOn)}
                {rec.previous.parity ? ` (${PARITY_LABEL[rec.previous.parity]})` : ""}: {diff ? Object.values(diff.byKey).filter((s) => s.status === "new").length : 0} новых, {diff ? Object.values(diff.byKey).filter((s) => s.status === "changed").length : 0} изменённых, {diff?.missing.length ?? 0} пропавших.
              </p>
            )}
            {days.map((date) => (
              <div key={date} className="overflow-hidden rounded-lg bg-surface hairline">
                <div className="px-3 py-2 font-display text-[13px] font-bold">
                  {capitalize(fmtWeekday(date))} <span className="font-sans font-medium text-muted">{fmtDayMonth(date)}</span>
                </div>
                <ul className="divide-y divide-border border-t border-border">
                  {rec.draft
                    .filter((d) => d.date === date)
                    .map((d) => {
                      const st = diff?.byKey[d.key];
                      const fromCatalog = [d.teacherSource === "catalog" && "преп.", d.roomSource === "catalog" && "ауд."].filter(Boolean).join(" и ");
                      return (
                        <li key={d.key} className={cn("flex items-stretch", !d.include && "opacity-40")}>
                          <button type="button" onClick={() => toggle(d.key)} className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2 text-left">
                            <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2", d.include ? "border-accent bg-accent text-accent-ink" : "border-border-strong")}>
                              {d.include && <Check className="size-3" strokeWidth={3} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
                                <span className="font-semibold tnum">{d.slot}.</span>
                                <span className={cn("font-medium", d.uncertain && "text-warn")}>{d.title}</span>
                                {!d.subjectId && <Badge tone="warn">нет в справочнике</Badge>}
                                {d.subjectId && d.matchKind === "fuzzy" && <Badge tone="warn">≈ {subjectName(d.subjectId)}</Badge>}
                                {d.weekType !== "both" && <Badge>{d.weekType === "upper" ? "верх" : "низ"}</Badge>}
                                {st?.status === "new" && <Badge tone="accent">новая</Badge>}
                                {st?.status === "changed" && <Badge tone="warn">изменена</Badge>}
                              </span>
                              <span className="block text-[12px] text-muted">
                                {[d.startsAt && `${d.startsAt}–${d.endsAt}`, KIND_LABEL[d.kind], d.room, d.teacherName].filter(Boolean).join(" · ")}
                                {fromCatalog && <span className="text-dim"> · {fromCatalog} из справочника</span>}
                              </span>
                              {st?.status === "changed" && <span className="block text-[11px] text-warn">{st.changes.join("; ")}</span>}
                              {d.uncertain && <span className="block text-[11px] text-dim">raw: {d.rawText}</span>}
                            </span>
                          </button>
                          <button type="button" onClick={() => { setError(null); setEdit(d); }} aria-label="Изменить пару" className="grid w-11 shrink-0 place-items-center text-muted active:bg-surface-2">
                            <Pencil className="size-4" />
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
            {rec.draft.length === 0 && <p className="text-center text-[13px] text-muted">Пар не найдено. Перефотографируй нужную страницу или заполни вручную.</p>}
            {diff && diff.missing.length > 0 && (
              <div className="overflow-hidden rounded-lg bg-surface hairline">
                <div className="px-3 py-2 text-[12px] font-medium text-muted">Были на прошлой неделе, в скане нет</div>
                <ul className="divide-y divide-border border-t border-border">
                  {diff.missing.map((m, i) => (
                    <li key={`${m.date}-${m.slot}-${i}`} className="px-3 py-2 text-[13px]">
                      <span className="text-muted">{capitalize(fmtWeekday(m.date))}, {m.slot}.</span> <span className="font-medium">{m.title}</span>
                      <span className="block text-[12px] text-dim">{[KIND_LABEL[m.kind], m.room, m.teacherName].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {hasLessons && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1 text-[13px] font-medium">
                  <button type="button" onClick={() => setMode("replace")} className={cn("h-10 rounded-full", mode === "replace" ? "bg-surface text-fg shadow-sm" : "text-muted")}>
                    Заменить все
                  </button>
                  <button type="button" onClick={() => setMode("add-missing")} className={cn("h-10 rounded-full", mode === "add-missing" ? "bg-surface text-fg shadow-sm" : "text-muted")}>
                    Добавить только новые
                  </button>
                </div>
                <p className="text-[11px] text-dim">
                  {mode === "replace" ? "Все пары недели будут удалены и заменены отмеченными." : "Существующие пары не тронем; добавим те, которых нет на ту же дату и номер пары."}
                </p>
              </div>
            )}
            {error && <div className="text-[13px] text-danger">{error}</div>}
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" onClick={() => setRec(null)}>
                Назад
              </Button>
              <Button className="flex-1" loading={pending} disabled={included.length === 0 || parityUnknown} onClick={apply}>
                {applyLabel} {included.length} {pluralRu(included.length, "пару", "пары", "пар")}
              </Button>
            </div>
            <p className="text-[11px] text-dim">
              Предметы вне справочника ({subjects.length} шт.) сохранятся текстом — позже их можно привязать в редакторе.
            </p>
          </div>
        )}
      </Sheet>

      <Sheet open={edit !== null} onClose={() => setEdit(null)} title="Пара из скана">
        {edit && (
          <div className="space-y-3 pb-2">
            <div className="text-[13px] text-muted">
              {capitalize(fmtWeekday(edit.date))}, {fmtDayMonth(edit.date)}
              {edit.scanTitle !== edit.title && <span className="block text-[12px] text-dim">В скане: «{edit.scanTitle}»</span>}
            </div>
            <Field label="Предмет">
              <Select value={edit.subjectId ?? ""} onChange={(e) => onEditSubject(e.target.value)}>
                <option value="">Свободный текст</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Название (как в расписании)">
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Математический анализ" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Вид">
                <Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as LessonKind })}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k] || "Другое"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Аудитория">
                <Input value={edit.room ?? ""} onChange={(e) => setEdit({ ...edit, room: e.target.value, roomSource: "scan" })} placeholder="214" />
              </Field>
            </div>
            <Field label="Преподаватель">
              <Input value={edit.teacherName ?? ""} onChange={(e) => setEdit({ ...edit, teacherName: e.target.value, teacherSource: "scan" })} placeholder="Иванова И.И." />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Пара №">
                <Input type="number" min={1} max={10} value={edit.slot} onChange={(e) => setEdit({ ...edit, slot: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} />
              </Field>
              <Field label="Начало">
                <Input type="time" value={edit.startsAt} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} />
              </Field>
              <Field label="Конец">
                <Input type="time" value={edit.endsAt} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} />
              </Field>
            </div>
            <Field label="Чётность" hint={parity ? `Неделя ${PARITY_LABEL[parity]}: пара другой чётности будет выключена` : undefined}>
              <Select value={edit.weekType} onChange={(e) => setEdit({ ...edit, weekType: e.target.value as DraftLesson["weekType"] })}>
                <option value="both">Каждую неделю</option>
                <option value="upper">Только верхняя</option>
                <option value="lower">Только нижняя</option>
              </Select>
            </Field>
            {error && <div className="text-[13px] text-danger">{error}</div>}
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" onClick={() => setEdit(null)}>
                Отмена
              </Button>
              <Button className="flex-1" onClick={saveEdit}>
                Готово
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
