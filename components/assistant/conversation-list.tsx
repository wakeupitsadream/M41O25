import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { conversationDate } from "@/lib/assistant/client/format";
import type { ConversationListItem } from "@/lib/assistant/types";

/** Список бесед раздела. Серверный компонент: дата считается в поясе группы, который страница передаёт явно. */
export function ConversationList({ items, today, tz }: { items: ConversationListItem[]; today: string; tz: string }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface hairline">
      {items.map((c) => (
        <li key={c.id}>
          <Link href={`/group/assistant/${c.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-surface-2">
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{c.title}</span>
                <span className="shrink-0 text-[12px] text-dim tnum">{conversationDate(c.updatedAt, today, tz)}</span>
              </span>
              {c.preview && <span className="mt-0.5 block truncate text-[13px] text-muted">{c.preview}</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-dim" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
