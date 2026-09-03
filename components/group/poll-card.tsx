"use client";

import { useGuardedRouter } from "@/components/features/nav-guard";
import { useOptimistic, useTransition } from "react";
import { Check, EyeOff, Lock, Trash2, Undo2 } from "lucide-react";
import { motion } from "motion/react";
import type { PollItem } from "@/lib/group/query";
import { deletePoll, setPollClosed, vote } from "@/app/(app)/group/actions";
import { fmtDateTime } from "@/lib/hw/format";
import { Avatar, Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, displayName, pluralRu } from "@/lib/utils";

export function PollCard({ poll, me }: { poll: PollItem; me: { id: string; isMod: boolean; isAdmin: boolean } }) {
  const router = useGuardedRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [state, applyVote] = useOptimistic(poll, (prev: PollItem, optionId: string) => {
    const has = prev.myVotes.includes(optionId);
    let myVotes = has ? prev.myVotes.filter((v) => v !== optionId) : prev.isMulti ? [...prev.myVotes, optionId] : [optionId];
    const options = prev.options.map((o) => {
      const was = prev.myVotes.includes(o.id);
      const now = myVotes.includes(o.id);
      return { ...o, count: o.count + (now ? 1 : 0) - (was ? 1 : 0) };
    });
    myVotes = [...new Set(myVotes)];
    return { ...prev, myVotes, options, voters: prev.voters + (prev.myVotes.length === 0 && myVotes.length > 0 ? 1 : prev.myVotes.length > 0 && myVotes.length === 0 ? -1 : 0) };
  });
  const total = Math.max(1, ...state.options.map((o) => o.count), state.options.reduce((n, o) => n + o.count, 0) || 1);
  const maxCount = Math.max(...state.options.map((o) => o.count));
  const canManage = me.isMod || poll.author.id === me.id;

  return (
    <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={cn("rounded-lg bg-surface p-4 hairline", state.closed && "opacity-80")}>
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Avatar user={poll.author} size="xs" />
        <span className="font-semibold text-fg">{displayName(poll.author)}</span>
        <span>{fmtDateTime(poll.createdAt)}</span>
        <span className="flex-1" />
        {poll.isAnonymous && (
          <Badge>
            <EyeOff className="size-3" /> анонимно
          </Badge>
        )}
        {state.closed && (
          <Badge tone="warn">
            <Lock className="size-3" /> закрыт
          </Badge>
        )}
      </div>
      <h2 className="mt-2.5 font-display text-[18px] font-bold leading-snug">{poll.question}</h2>
      {poll.isMulti && <div className="mt-1 text-[12px] text-dim">Можно выбрать несколько</div>}

      <ul className="mt-3 space-y-2">
        {state.options.map((o) => {
          const mine = state.myVotes.includes(o.id);
          const pct = state.voters ? Math.round((o.count / Math.max(1, state.options.reduce((n, x) => n + x.count, 0))) * 100) : 0;
          const width = total ? (o.count / Math.max(1, maxCount)) * 100 : 0;
          const leader = o.count > 0 && o.count === maxCount;
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={state.closed || pending}
                onClick={() => start(async () => { applyVote(o.id); const res = await vote(poll.id, o.id); if (!res.ok) toast(res.error ?? "Голос не принят"); router.refresh(); })}
                className={cn("relative w-full overflow-hidden rounded-md px-3.5 py-3 text-left hairline transition active:scale-[0.99]", mine ? "ring-1 ring-accent/70" : "")}
              >
                <motion.span
                  className={cn("absolute inset-y-0 left-0 rounded-md", mine ? "bg-accent/20" : leader ? "bg-surface-3" : "bg-surface-2")}
                  initial={false}
                  animate={{ width: `${Math.max(width, 0)}%` }}
                  transition={{ type: "spring", stiffness: 160, damping: 24 }}
                />
                <span className="relative flex items-center gap-2">
                  <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", mine ? "border-accent bg-accent text-accent-ink" : "border-border-strong")}>
                    {mine && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 text-[15px] font-medium">{o.text}</span>
                  <span className="text-[13px] font-semibold text-muted tnum">{o.count > 0 ? `${pct}%` : ""}</span>
                </span>
                {!poll.isAnonymous && o.voters.length > 0 && (
                  <span className="relative mt-1.5 flex items-center gap-1 pl-7">
                    {o.voters.slice(0, 8).map((v) => (
                      <Avatar key={v.id} user={v} size="xs" />
                    ))}
                    {o.voters.length > 8 && <span className="text-[11px] text-dim">+{o.voters.length - 8}</span>}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center gap-3 text-[12px] text-muted">
        <span>
          {state.voters} {pluralRu(state.voters, "голос", "голоса", "голосов")}
        </span>
        {poll.closesAt && !state.closed && <span>· до {fmtDateTime(poll.closesAt)}</span>}
        <span className="flex-1" />
        {canManage && (
          <button type="button" className="flex items-center gap-1 text-dim" disabled={pending} onClick={() => start(async () => { const res = await setPollClosed(poll.id, !state.closed); if (!res.ok) toast(res.error ?? "Не получилось"); router.refresh(); })}>
            {state.closed ? <Undo2 className="size-3.5" /> : <Lock className="size-3.5" />}
            {state.closed ? "открыть" : "закрыть"}
          </button>
        )}
        {(me.isAdmin || poll.author.id === me.id) && (
          <button
            type="button"
            aria-label="Удалить"
            className="text-dim"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Удалить опрос?")) start(async () => { const res = await deletePoll(poll.id); if (!res.ok) toast(res.error ?? "Не получилось"); router.refresh(); });
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </motion.article>
  );
}
