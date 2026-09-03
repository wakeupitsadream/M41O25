"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { Check, Lock, Trash2, Undo2 } from "lucide-react";
import { motion } from "motion/react";
import type { getTask } from "@/lib/group/query";
import { deleteTask, setTaskClosed, toggleTaskCheck } from "@/app/(app)/group/actions";
import { dueLabel, fmtDateTime } from "@/lib/hw/format";
import { Avatar, Badge } from "@/components/ui/primitives";
import { Linkify } from "@/components/ui/linkify";
import { Button } from "@/components/ui/button";
import { cn, displayName, pluralRu } from "@/lib/utils";

type Task = NonNullable<Awaited<ReturnType<typeof getTask>>>;

export function TaskDetail({ task, me, today }: { task: Task; me: { id: string; isAdmin: boolean; isMod: boolean }; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [people, toggle] = useOptimistic(task.people, (prev: Task["people"], userId: string) =>
    prev.map((p) => (p.id === userId ? { ...p, checkedAt: p.checkedAt ? null : new Date().toISOString() } : p)),
  );
  const done = people.filter((p) => p.checkedAt);
  const left = people.filter((p) => !p.checkedAt);
  const pct = people.length ? Math.round((done.length / people.length) * 100) : 0;
  const due = task.dueDate ? dueLabel(task.dueDate, today) : null;
  const mine = people.find((p) => p.id === me.id);

  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      const res = (await fn()) as { ok?: boolean; error?: string } | undefined;
      if (res && res.ok === false) return setError(res.error ?? "Не удалось");
      router.refresh();
    });

  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Avatar user={task.author} size="xs" />
        <span>{displayName(task.author)}</span>
        <span>· {fmtDateTime(task.createdAt)}</span>
        {due && !task.closed && <Badge tone={due.tone}>{due.text}</Badge>}
      </div>
      {task.description && <Linkify text={task.description} className="text-[16px] leading-relaxed" />}

      {task.trackChecks && (
        <>
          <div className="rounded-lg bg-surface p-4 hairline">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-muted">Сдали</span>
              <span className="font-display text-[22px] font-bold tnum">
                {done.length} <span className="text-[14px] text-muted">/ {people.length}</span>
              </span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
              <motion.div className={cn("h-full rounded-full", pct === 100 ? "bg-ok" : "bg-accent")} initial={false} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 160, damping: 22 }} />
            </div>
            {mine && (
              <div className={cn("mt-3 text-[13px] font-medium", mine.checkedAt ? "text-ok" : "text-muted")}>
                {mine.checkedAt ? "✓ Ты сдал" : "Ты пока не отмечен"}
              </div>
            )}
          </div>

          {!me.isAdmin && (
            <p className="flex items-center gap-1.5 text-[12px] text-dim">
              <Lock className="size-3" /> Отметки ставит админ
            </p>
          )}

          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
              Ещё не сдали {left.length > 0 && <span className="text-dim">{left.length}</span>}
            </h2>
            <PeopleList people={left} canToggle={me.isAdmin && !task.closed} pending={pending} onToggle={(id) => start(async () => { toggle(id); await toggleTaskCheck(task.id, id); router.refresh(); })} />
            {left.length === 0 && <div className="rounded-md bg-ok/10 px-3.5 py-3 text-[14px] text-ok">Все сдали 🎉</div>}
          </section>
          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
              Сдали {done.length > 0 && <span className="text-dim">{done.length}</span>}
            </h2>
            <PeopleList people={done} canToggle={me.isAdmin && !task.closed} pending={pending} onToggle={(id) => start(async () => { toggle(id); await toggleTaskCheck(task.id, id); router.refresh(); })} />
          </section>
        </>
      )}

      {error && <div className="text-[13px] text-danger">{error}</div>}

      {me.isMod && (
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" loading={pending} onClick={() => run(() => setTaskClosed(task.id, !task.closed))}>
            {task.closed ? (
              <>
                <Undo2 className="size-4" /> Открыть снова
              </>
            ) : (
              <>
                <Check className="size-4" /> Закрыть задачу
              </>
            )}
          </Button>
          <Button
            variant="danger"
            size="icon"
            aria-label="Удалить"
            onClick={() => {
              if (window.confirm("Удалить задачу?")) run(() => deleteTask(task.id));
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function PeopleList({ people, canToggle, pending, onToggle }: { people: Task["people"]; canToggle: boolean; pending: boolean; onToggle: (id: string) => void }) {
  if (people.length === 0) return null;
  return (
    <ul className="overflow-hidden rounded-lg bg-surface hairline">
      {people.map((p) => (
        <li key={p.id} className="border-b border-border last:border-0">
          <button
            type="button"
            disabled={!canToggle || pending}
            onClick={() => onToggle(p.id)}
            className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left", canToggle && "active:bg-surface-2")}
          >
            <Avatar user={p} size="sm" />
            <span className="flex-1 text-[15px] font-medium">{p.fullName}</span>
            <span className={cn("grid size-7 place-items-center rounded-full", p.checkedAt ? "bg-ok text-bg" : "bg-surface-2 text-dim hairline")}>
              {p.checkedAt && <Check className="size-4" strokeWidth={3} />}
            </span>
          </button>
        </li>
      ))}
      <li className="sr-only">{people.length} {pluralRu(people.length, "человек", "человека", "человек")}</li>
    </ul>
  );
}
