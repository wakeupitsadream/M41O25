"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useGuardedRouter } from "@/components/features/nav-guard";
import { CalendarClock, ChevronDown, CloudUpload, Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createHomework } from "@/app/(app)/hw/actions";
import { addDaysIso, capitalize, fmtDayShort, fmtWeekday } from "@/lib/schedule/time";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { addToQueue, clearDraft, isOfflineError, newQueueKey, pruneQueue, readDraft, readQueue, saveDraft, writeQueue } from "@/lib/hw/draft";
import { AttachmentUploader, type UploadedFile } from "./attachment-uploader";
import { cn } from "@/lib/utils";

type SubjectOpt = { id: string; name: string; shortName: string | null; color: string | null };

/** Ближайшие пары предмета (то же, что UpcomingLesson в lib/hw/query.ts; тип продублирован, чтобы клиент не тянул server-only модуль). */
export type UpcomingLessonOpt = { id: string; date: string; startsAt: string };

type Props = {
  subjects: SubjectOpt[];
  suggestedSubjectId: string | null;
  upcomingBySubject: Record<string, UpcomingLessonOpt[]>;
  today: string;
  /** Чей это черновик: на общем телефоне чужой набранный текст показывать нельзя. */
  meId: string;
};

/** Поля, которые переживают отсутствие сети и перезапуск приложения (lib/hw/draft.ts). */
type DraftFields = { body: string; title: string; subjectId: string | null; dueOverride: string | null };

/** Пауза перед записью черновика: набор текста не должен дёргать localStorage на каждую букву. */
const DRAFT_DEBOUNCE_MS = 400;

const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine);

/**
 * «ДЗ за 20 секунд»: одно поле, предмет уже выбран по текущей паре, дедлайн — следующая пара предмета,
 * запись сразу привязывается к этой паре (счётчик ДЗ на карточке пары в расписании).
 * «Оформить подробнее» раскрывает заголовок, дату и вложения.
 *
 * В аудитории сети обычно нет, поэтому набранное не теряется: до отправки черновик лежит в localStorage,
 * а упавшая из-за сети отправка уходит в очередь и уезжает сама (lib/hw/draft.ts, components/hw/hw-outbox.tsx).
 */
export function QuickAddForm({ subjects, suggestedSubjectId, upcomingBySubject, today, meId }: Props) {
  const router = useGuardedRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<DraftFields>({ body: "", title: "", subjectId: suggestedSubjectId, dueOverride: null });
  const { body, title, subjectId, dueOverride } = form;
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  // Пока черновик не восстановлен, писать его нельзя: пустая форма затёрла бы сохранённое.
  const restored = useRef(false);
  // Запись ушла на сервер — черновик больше не воскрешаем.
  const sent = useRef(false);
  // Актуальные поля для сохранения по сворачиванию приложения: слушатели не перевешиваются на каждую букву.
  const live = useRef(form);

  const patch = (p: Partial<DraftFields>) => setForm((f) => ({ ...f, ...p }));

  const subjectLessons = useMemo(() => (subjectId ? upcomingBySubject[subjectId] ?? [] : []), [subjectId, upcomingBySubject]);
  const autoDue = subjectLessons[0]?.date ?? addDaysIso(today, 7);
  const dueDate = dueOverride ?? autoDue;
  const dueIsAuto = dueOverride === null && subjectLessons.length > 0;
  // Пара предмета в день дедлайна — к ней привяжем запись; если на выбранную дату пары нет, привязки не будет.
  const lesson = subjectLessons.find((l) => l.date === dueDate) ?? null;

  const ordered = useMemo(() => {
    const s = [...subjects];
    if (suggestedSubjectId) s.sort((a, b) => (a.id === suggestedSubjectId ? -1 : b.id === suggestedSubjectId ? 1 : 0));
    return s;
  }, [subjects, suggestedSubjectId]);

  // Черновик восстанавливается при появлении формы: после перезапуска замороженной PWA это новое монтирование.
  useEffect(() => {
    const d = readDraft(meId);
    restored.current = true;
    if (!d) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- черновик лежит в localStorage: на сервере его нет, подставить можно только после монтирования.
    setForm({ body: d.body, title: d.title, subjectId: d.subjectId, dueOverride: d.dueOverride });
    // Вместе с черновиком возвращаем раскрытую часть формы, иначе сохранённый заголовок и своя дата не видны.
    if (d.title || d.dueOverride) setMore(true);
  }, [meId]);

  // Пишем с задержкой, чтобы не дёргать localStorage на каждую букву.
  useEffect(() => {
    live.current = form;
    if (!restored.current || sent.current) return;
    const t = setTimeout(() => saveDraft({ userId: meId, ...form, savedAt: Date.now() }), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [meId, form]);

  // iOS замораживает PWA сразу при сворачивании — сохраняем не дожидаясь задержки, иначе последние буквы пропадут.
  useEffect(() => {
    const save = () => {
      if (!restored.current || sent.current) return;
      saveDraft({ userId: meId, ...live.current, savedAt: Date.now() });
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHide);
      save();
    };
  }, [meId]);

  const submit = () => {
    setError(null);
    setQueued(null);
    const payload = { body, title, subjectId, dueDate, lessonId: lesson?.id ?? null, attachmentIds: files.map((f) => f.id) };
    start(async () => {
      try {
        const res = await createHomework(payload);
        if (!res.ok) return setError(res.error);
        sent.current = true;
        clearDraft();
        router.replace(`/hw/${res.data!.id}`);
      } catch (e) {
        if (!isOfflineError(e, isOnline())) {
          // Не сеть, а что-то неожиданное: ничего не чистим — черновик на месте, можно жать ещё раз.
          setError("Не отправилось. Попробуй ещё раз — текст сохранён.");
          return;
        }
        // Сети нет: запись уходит в очередь (components/hw/hw-outbox.tsx) и отправится сама, когда появится связь.
        writeQueue(addToQueue(pruneQueue(readQueue(), Date.now()), { key: newQueueKey(), userId: meId, ...payload, queuedAt: Date.now(), tries: 0, lastError: null }));
        clearDraft();
        setQueued(
          files.length
            ? "Нет сети — сохранил у тебя. Отправлю вместе с фото, когда появится связь."
            : "Нет сети — сохранил у тебя, отправлю, когда появится связь.",
        );
        setFiles([]);
        setForm({ body: "", title: "", subjectId, dueOverride: null });
      }
    });
  };

  const dueHint = dueIsAuto
    ? `следующая пара${lesson ? `, ${lesson.startsAt}` : ""}`
    : dueOverride
      ? lesson
        ? `своя дата, пара в ${lesson.startsAt}`
        : "своя дата"
      : "через неделю";

  return (
    <div className="space-y-4">
      <Textarea
        autoFocus
        value={body}
        onChange={(e) => patch({ body: e.target.value })}
        placeholder="Что задали? Например: «№ 214–220, стр. 48. Сдать письменно»"
        className="min-h-32 text-[17px]"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 scrollbar-none">
        {ordered.map((s) => {
          const active = s.id === subjectId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => patch({ subjectId: active ? null : s.id, dueOverride: null })}
              className={cn("shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition", active ? "text-bg" : "bg-surface-2 text-muted hairline")}
              style={active ? { background: s.color ?? "#F4F4F6" } : undefined}
            >
              {s.shortName ?? s.name}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setMore((m) => !m)}
        className="flex w-full items-center gap-2 rounded-md bg-surface-2 px-3.5 py-3 text-left text-[14px] hairline"
      >
        <CalendarClock className="size-4 text-muted" />
        <span className="flex-1">
          Сдать <b>{capitalize(fmtWeekday(dueDate, false))}, {fmtDayShort(dueDate)}</b>
          <span className="text-muted"> · {dueHint}</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted transition", more && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {more && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-4 overflow-hidden">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Дедлайн">
                <Input type="date" value={dueDate} min={today} onChange={(e) => patch({ dueOverride: e.target.value || null })} />
              </Field>
              <Field label="Заголовок">
                <Input value={title} onChange={(e) => patch({ title: e.target.value })} placeholder="Контрольная" />
              </Field>
            </div>
            <Field label="Вложения">
              <AttachmentUploader value={files} onChange={setFiles} />
            </Field>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <div className="text-[13px] text-danger">{error}</div>}

      {queued && (
        <div className="flex items-start gap-2 rounded-md bg-surface-2 px-3.5 py-3 text-[13px] hairline">
          <CloudUpload className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>
            {queued} <span className="text-muted">Можно закрывать — ничего не пропадёт.</span>
          </span>
        </div>
      )}

      <div className="flex gap-2">
        <Button size="lg" className="flex-1" loading={pending} disabled={!body.trim()} onClick={submit}>
          <Send className="size-4" /> Отправить
        </Button>
        {!more && (
          <Button size="lg" variant="secondary" onClick={() => setMore(true)}>
            Подробнее
          </Button>
        )}
      </div>
    </div>
  );
}
