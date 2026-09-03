"use client";

import { useOptimistic, useTransition } from "react";
import { toggleReaction } from "@/app/(app)/group/actions";
import type { ReactionSummary } from "@/lib/group/query";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

const EMOJI = ["🔥", "👍", "💀", "❤️"];

export function ReactionBar({ entityType, entityId, reactions }: { entityType: "news" | "homework" | "task"; entityId: string; reactions: ReactionSummary }) {
  const [state, apply] = useOptimistic(reactions, (prev: ReactionSummary, emoji: string) => {
    const found = prev.find((r) => r.emoji === emoji);
    if (!found) return [...prev, { emoji, count: 1, mine: true }];
    return prev
      .map((r) => (r.emoji === emoji ? { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine } : r))
      .filter((r) => r.count > 0);
  });
  const [, start] = useTransition();
  const toast = useToast();

  return (
    <div className="flex flex-wrap gap-1.5">
      {EMOJI.map((e) => {
        const r = state.find((x) => x.emoji === e);
        return (
          <button
            key={e}
            type="button"
            onClick={() =>
              start(async () => {
                apply(e);
                const res = await toggleReaction(entityType, entityId, e);
                if (!res.ok) toast(res.error ?? "Реакция не сохранилась");
              })
            }
            className={cn(
              "flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] transition active:scale-95",
              r?.mine ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-muted",
              !r && "opacity-70",
            )}
          >
            <span>{e}</span>
            {r && r.count > 0 && <span className="font-semibold tnum">{r.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
