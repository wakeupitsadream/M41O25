"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronDown, Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createHomework } from "@/app/(app)/hw/actions";
import { addDaysIso, capitalize, fmtDayShort, fmtWeekday } from "@/lib/schedule/time";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { AttachmentUploader, type UploadedFile } from "./attachment-uploader";
import { cn } from "@/lib/utils";

type SubjectOpt = { id: string; name: string; shortName: string | null; color: string | null };

type Props = {
  subjects: SubjectOpt[];
  suggestedSubjectId: string | null;
  nextBySubject: Record<string, string>;
  today: string;
};

/**
 * «ДЗ за 20 секунд»: одно поле, предмет уже выбран по текущей паре, дедлайн — следующая пара предмета.
 * «Оформить подробнее» раскрывает заголовок, дату и вложения.
 */
export function QuickAddForm({ subjects, suggestedSubjectId, nextBySubject, today }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState<string | null>(suggestedSubjectId);
  const [dueOverride, setDueOverride] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoDue = useMemo(() => (subjectId && nextBySubject[subjectId]) || addDaysIso(today, 7), [subjectId, nextBySubject, today]);
  const dueDate = dueOverride ?? autoDue;
  const dueIsAuto = dueOverride === null && Boolean(subjectId && nextBySubject[subjectId]);

  const ordered = useMemo(() => {
    const s = [...subjects];
    if (suggestedSubjectId) s.sort((a, b) => (a.id === suggestedSubjectId ? -1 : b.id === suggestedSubjectId ? 1 : 0));
    return s;
  }, [subjects, suggestedSubjectId]);

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await createHomework({ body, title, subjectId, dueDate, attachmentIds: files.map((f) => f.id) });
      if (!res.ok) return setError(res.error);
      router.replace(`/hw/${res.data!.id}`);
    });
  };

  return (
    <div className="space-y-4">
      <Textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
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
              onClick={() => {
                setSubjectId(active ? null : s.id);
                setDueOverride(null);
              }}
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
          <span className="text-muted"> · {dueIsAuto ? "следующая пара" : dueOverride ? "своя дата" : "через неделю"}</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted transition", more && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {more && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-4 overflow-hidden">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Дедлайн">
                <Input type="date" value={dueDate} min={today} onChange={(e) => setDueOverride(e.target.value || null)} />
              </Field>
              <Field label="Заголовок">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Контрольная" />
              </Field>
            </div>
            <Field label="Вложения">
              <AttachmentUploader value={files} onChange={setFiles} />
            </Field>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <div className="text-[13px] text-danger">{error}</div>}

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
