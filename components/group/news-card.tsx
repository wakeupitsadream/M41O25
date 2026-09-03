"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FileText, Pin, PinOff, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import type { NewsItem } from "@/lib/group/query";
import { deleteNews, togglePinNews } from "@/app/(app)/group/actions";
import { fmtBytes, fmtDateTime } from "@/lib/hw/format";
import { Avatar, Badge } from "@/components/ui/primitives";
import { Linkify } from "@/components/ui/linkify";
import { ImageGrid } from "@/components/ui/image-grid";
import { ReactionBar } from "./reaction-bar";
import { cn, displayName } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

export function NewsCard({ item, canManage, isAdmin, meId }: { item: NewsItem; canManage: boolean; isAdmin: boolean; meId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const images = item.attachments.filter((a) => a.mime.startsWith("image/"));
  const docs = item.attachments.filter((a) => !a.mime.startsWith("image/"));
  const canDelete = isAdmin || item.author.id === meId;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-lg bg-surface p-4 hairline", item.pinned && "ring-1 ring-accent/50")}
    >
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Avatar user={item.author} size="xs" />
        <span className="font-semibold text-fg">{displayName(item.author)}</span>
        <span>{fmtDateTime(item.createdAt)}</span>
        {item.pinned && (
          <Badge tone="accent">
            <Pin className="size-3" /> закреп
          </Badge>
        )}
        <span className="flex-1" />
        {canManage && (
          <button type="button" aria-label={item.pinned ? "Открепить" : "Закрепить"} disabled={pending} className="text-dim" onClick={() => start(async () => { const res = await togglePinNews(item.id); if (!res.ok) toast(res.error ?? "Не получилось"); router.refresh(); })}>
            {item.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </button>
        )}
        {canManage && canDelete && (
          <button
            type="button"
            aria-label="Удалить"
            disabled={pending}
            className="text-dim"
            onClick={() => {
              if (window.confirm("Удалить новость?")) start(async () => { const res = await deleteNews(item.id); if (!res.ok) toast(res.error ?? "Не получилось"); router.refresh(); });
            }}
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      {item.title && <h2 className="mt-2.5 font-display text-[18px] font-bold leading-snug">{item.title}</h2>}
      <Linkify text={item.body} className="mt-2 text-[15px] leading-relaxed" />
      {images.length > 0 && <ImageGrid images={images} className="mt-3" rounded="rounded-md" singleMax="max-h-80" />}
      {docs.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {docs.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-md bg-surface-2 px-3 py-2 text-[13px] active:bg-surface-3">
                <FileText className="size-4 text-muted" />
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <span className="text-dim">{fmtBytes(a.size)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <ReactionBar entityType="news" entityId={item.id} reactions={item.reactions} />
      </div>
    </motion.article>
  );
}
