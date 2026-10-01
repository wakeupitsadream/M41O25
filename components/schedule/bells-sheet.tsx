"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import type { SlotTime } from "@/lib/db/schema";
import { toMinutes } from "@/lib/schedule/time";
import { Badge } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * «Звонки»: сетка пар группы (group.slotTimes из payload расписания, то есть работает и офлайн). Первокурснику она
 * нужна каждый день первые недели, а до сих пор жила только в админке. Идущую сейчас пару подсвечиваем акцентом —
 * это «сейчас», ему акцент положен. Сетки у группы нет — кнопки нет: показывать пустую шторку нечестно.
 */
export function BellsButton({ slotTimes, minutes }: { slotTimes: SlotTime[]; minutes: number | null }) {
  const [open, setOpen] = useState(false);
  if (slotTimes.length === 0) return null;
  const slots = [...slotTimes].sort((a, b) => a.slot - b.slot);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-fg hairline active:scale-95"
      >
        <Clock className="size-4" /> Звонки
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Звонки">
        <ul className="divide-y divide-border pb-2">
          {slots.map((s) => {
            const now = minutes !== null && !!s.start && !!s.end && minutes >= toMinutes(s.start) && minutes < toMinutes(s.end);
            return (
              <li key={s.slot} className="flex min-h-12 items-center gap-3 py-2 text-[15px]">
                <span className={cn("w-20 shrink-0 font-semibold", now ? "text-accent" : "text-fg")}>{s.slot} пара</span>
                <span className={cn("flex-1 tnum", now ? "text-fg" : "text-muted")}>
                  {s.start}–{s.end}
                </span>
                {now && <Badge tone="accent">сейчас</Badge>}
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
