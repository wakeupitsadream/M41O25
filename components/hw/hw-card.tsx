"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { Check, MessageCircle, Paperclip, PencilLine, Copy } from "lucide-react";
import { motion } from "motion/react";
import type { HwListItem } from "@/lib/hw/query";
import { dueLabel } from "@/lib/hw/format";
import { toggleDone } from "@/app/(app)/hw/actions";
import { Avatar, Badge } from "@/components/ui/primitives";
import { cn, displayName } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

export function HwCard({ item, today, showDone, index = 0 }: { item: HwListItem; today: string; showDone: boolean; index?: number }) {
  const due = dueLabel(item.dueDate, today);
  const [done, setDone] = useOptimistic(item.done);
  const [, start] = useTransition();
  const toast = useToast();
  const color = item.subject?.color ?? "#9C9CA8";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(0.3, index * 0.03), type: "spring", stiffness: 420, damping: 34 }}
      className={cn("relative", done && "opacity-60")}
    >
      <Link href={`/hw/${item.id}`} className="relative block overflow-hidden rounded-lg bg-surface p-4 pl-5 hairline active:bg-surface-2">
        <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: color }} />
        <div className="flex items-center gap-2 pr-10">
          {item.subject ? (
            <span className="truncate rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: `${color}22`, color }}>
              {item.subject.shortName ?? item.subject.name}
            </span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-muted">Без предмета</span>
          )}
          <Badge tone={due.tone}>{due.text}</Badge>
          {item.duplicatesCount > 0 && (
            <Badge>
              <Copy className="size-3" /> +{item.duplicatesCount}
            </Badge>
          )}
        </div>
        {item.title && <div className="mt-2 font-display text-[16px] font-bold leading-snug">{item.title}</div>}
        <p className={cn("mt-1.5 line-clamp-3 whitespace-pre-line text-[15px] leading-relaxed", done && "line-through decoration-muted")}>{item.body}</p>
        <div className="mt-3 flex items-center gap-3 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <Avatar user={item.author} size="xs" />
            {displayName(item.author)}
          </span>
          <span className="flex-1" />
          {item.attachmentsCount > 0 && (
            <span className="flex items-center gap-1">
              <Paperclip className="size-3.5" /> {item.attachmentsCount}
            </span>
          )}
          {item.editsCount > 0 && (
            <span className="flex items-center gap-1">
              <PencilLine className="size-3.5" /> {item.editsCount}
            </span>
          )}
          {item.commentsCount > 0 && (
            <span className="flex items-center gap-1">
              <MessageCircle className="size-3.5" /> {item.commentsCount}
            </span>
          )}
        </div>
      </Link>
      {showDone && (
        <button
          type="button"
          aria-label={done ? "Снять отметку" : "Сделано"}
          onClick={() =>
            start(async () => {
              setDone(!done);
              const res = await toggleDone(item.id);
              if (!res.ok) toast(res.error ?? "Отметка не сохранилась");
            })
          }
          className={cn(
            "absolute right-3 top-3 grid size-8 place-items-center rounded-full transition active:scale-90",
            done ? "bg-accent text-accent-ink" : "bg-surface-2 text-dim hairline",
          )}
        >
          <Check className="size-4" strokeWidth={3} />
        </button>
      )}
    </motion.div>
  );
}
