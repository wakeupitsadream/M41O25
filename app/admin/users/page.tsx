import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ChevronRight, Lock, UserPlus } from "lucide-react";
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
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[28px] font-bold leading-none">Люди</h1>
        <Link href="/admin/users/new" className="flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-ink active:bg-accent-press">
          <UserPlus className="size-4" /> Добавить
        </Link>
      </div>
      <p className="text-[13px] text-muted">
        {active.length} в группе · замочек — человек уже вошёл и задал PIN
      </p>
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
