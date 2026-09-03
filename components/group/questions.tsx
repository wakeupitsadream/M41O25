"use client";

import { useGuardedRouter } from "@/components/features/nav-guard";
import { useState, useTransition } from "react";
import { CornerDownRight, Send, ShieldCheck, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import type { listQuestions } from "@/lib/group/query";
import { answerAnon, askAnon, deleteAnon } from "@/app/(app)/group/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { Linkify } from "@/components/ui/linkify";
import { displayName } from "@/lib/utils";

type Item = Awaited<ReturnType<typeof listQuestions>>[number];

const fmtHour = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: process.env.NEXT_PUBLIC_APP_TZ ?? "Asia/Yekaterinburg", day: "numeric", month: "short" }).format(new Date(iso)).replace(".", "");

export function QuestionsClient({ items, canAnswer, isAdmin }: { items: Item[]; canAnswer: boolean; isAdmin: boolean }) {
  const router = useGuardedRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [answerFor, setAnswerFor] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Ошибка");
      after?.();
      router.refresh();
    });

  return (
    <div className="space-y-5 pb-6">
      <div className="rounded-lg bg-surface p-4 hairline">
        <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">
          <ShieldCheck className="size-4 text-accent" />
          Автор не записывается вообще: ни в базе, ни в логах. Время округляется до часа.
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Про пересдачу, препода, деньги на подарок — что угодно" className="min-h-24" />
        <div className="mt-2 flex items-center gap-2">
          <span className="flex-1 text-[12px] text-dim">До 5 вопросов в день. Отвечает староста или админ.</span>
          <Button size="sm" loading={pending} disabled={text.trim().length < 5} onClick={() => run(() => askAnon(text), () => { setText(""); setSent(true); })}>
            <Send className="size-3.5" /> Спросить
          </Button>
        </div>
        {sent && <div className="mt-2 text-[13px] text-ok">Отправлено. Вопрос появится ниже без твоего имени.</div>}
        {error && <div className="mt-2 text-[13px] text-danger">{error}</div>}
      </div>

      {items.length === 0 && <EmptyState emoji="🤫" title="Вопросов пока нет" text="Первый анонимный вопрос — твой." />}

      <ul className="space-y-3">
        {items.map((q, i) => (
          <motion.li key={q.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(0.3, i * 0.03) }} className="rounded-lg bg-surface p-4 hairline">
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-[12px]">🎭</span>
              <span className="font-semibold text-fg">Аноним</span>
              <span>{fmtHour(q.createdAt)}</span>
              <span className="flex-1" />
              {isAdmin && (
                <button type="button" aria-label="Удалить" className="text-dim" onClick={() => { if (window.confirm("Удалить вопрос?")) run(() => deleteAnon(q.id)); }}>
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
            <Linkify text={q.body} className="mt-2 text-[15px] leading-relaxed" />
            {q.answerBody && q.answerer ? (
              <div className="mt-3 flex gap-2">
                <CornerDownRight className="mt-1 size-4 shrink-0 text-dim" />
                <div className="flex-1 rounded-md bg-accent/10 px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-[12px]">
                    <Avatar user={q.answerer} size="xs" />
                    <span className="font-semibold text-accent">{displayName(q.answerer)}</span>
                    {q.answeredAt && <span className="text-dim">{fmtHour(q.answeredAt)}</span>}
                  </div>
                  <Linkify text={q.answerBody} className="mt-1 text-[15px] leading-relaxed" />
                </div>
              </div>
            ) : canAnswer ? (
              answerFor === q.id ? (
                <div className="mt-3 space-y-2">
                  <Textarea autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Ответ увидят все" className="min-h-20" />
                  <div className="flex gap-2">
                    <Button size="sm" loading={pending} disabled={!answer.trim()} onClick={() => run(() => answerAnon(q.id, answer), () => { setAnswer(""); setAnswerFor(null); })}>
                      Ответить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAnswerFor(null)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <button type="button" className="mt-3 text-[13px] font-semibold text-accent" onClick={() => setAnswerFor(q.id)}>
                  Ответить
                </button>
              )
            ) : (
              <div className="mt-3 text-[12px] text-dim">Ответа пока нет</div>
            )}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
