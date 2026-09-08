import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ChevronRight, ClipboardList, Lock, UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { Avatar, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const ROLE: Record<string, string> = { admin: "админ", moderator: "староста", student: "" };

export default async function AdminUsers() {
  const admin = await requireRole("admin");
  const list = await db.select().from(users).where(eq(users.groupId, admin.groupId)).orderBy(asc(users.status), asc(users.fullName));
  const active = list.filter((u) => u.status === "active");
  const removed = list.filter((u) => u.status === "removed");

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="min-w-0 truncate font-display text-[28px] font-bold leading-none">Люди</h1>
          <span className="shrink-0 text-[13px] text-muted">{active.length} в группе</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/users/import" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full px-3 text-[15px] font-semibold text-fg hairline active:bg-surface-2">
            <ClipboardList className="size-4 shrink-0" /> Списком
          </Link>
          <Link href="/admin/users/new" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-accent px-3 text-[15px] font-semibold text-accent-ink active:bg-accent-press">
            <UserPlus className="size-4 shrink-0" /> Добавить
          </Link>
        </div>
      </div>
      {list.some((u) => u.pinHash) && (
        <p className="flex items-center justify-end gap-1.5 px-1 text-[12px] text-dim">
          <Lock className="size-3.5 shrink-0" /> — вошёл и задал PIN
        </p>
      )}
      <ul className="overflow-hidden rounded-lg bg-surface hairline">
        {[...active, ...removed].map((u) => (
          <li key={u.id} className="border-b border-border last:border-0">
            <Link href={`/admin/users/${u.id}`} className={cn("flex items-center gap-3 px-4 py-3 active:bg-surface-2", u.status === "removed" && "opacity-50")}>
              <Avatar user={u} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{u.fullName}</span>
                {(u.nickname || u.birthday) && (
                  <span className="block truncate text-[12px] text-muted">
                    {[u.nickname, u.birthday ? `ДР ${u.birthday.slice(8, 10)}.${u.birthday.slice(5, 7)}` : null].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              {u.status === "removed" ? <Badge tone="danger">удалён</Badge> : ROLE[u.role] ? <Badge tone="accent">{ROLE[u.role]}</Badge> : null}
              {u.pinHash && <Lock className="size-4 text-dim" />}
              <ChevronRight className="size-4 text-dim" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
