import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { groups, users } from "@/lib/db/schema";
import { getSessionUser, readInviteGroupId } from "@/lib/auth";
import { Avatar } from "@/components/ui/primitives";

export const metadata = { title: "Кто ты?" };

export default async function WhoPage() {
  if (await getSessionUser()) redirect("/s");
  const groupId = await readInviteGroupId();
  if (!groupId) redirect("/enter");

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  const list = await db
    .select({ id: users.id, fullName: users.fullName, avatarEmoji: users.avatarEmoji, color: users.color, claimed: users.pinHash })
    .from(users)
    .where(and(eq(users.groupId, groupId), eq(users.status, "active")))
    .orderBy(asc(users.fullName));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[13px] font-medium uppercase tracking-wide text-muted">{group?.shortName}</div>
        <h1 className="font-display text-[30px] font-bold leading-tight">Кто ты?</h1>
        <p className="text-[15px] text-muted">Найди себя в списке. Замочек — профиль уже занят, понадобится PIN.</p>
      </div>
      <ul className="overflow-hidden rounded-lg bg-surface hairline">
        {list.map((u) => (
          <li key={u.id} className="border-b border-border last:border-0">
            <Link
              href={`/enter/pin?u=${u.id}`}
              className="flex items-center gap-3 px-4 py-3 transition active:bg-surface-2"
            >
              <Avatar user={u} size="sm" />
              <span className="flex-1 text-[15px] font-medium">{u.fullName}</span>
              {u.claimed && <Lock className="size-4 text-dim" />}
            </Link>
          </li>
        ))}
        {list.length === 0 && <li className="px-4 py-6 text-center text-muted">В группе пока никого нет</li>}
      </ul>
      <Link href="/enter" className="block text-center text-[14px] text-muted underline-offset-4 hover:underline">
        Другой код
      </Link>
    </div>
  );
}
