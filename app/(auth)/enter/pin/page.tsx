import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser, readInviteGroupId } from "@/lib/auth";
import { Avatar } from "@/components/ui/primitives";
import { PinForm } from "./pin-form";

export const metadata = { title: "PIN" };

export default async function PinPage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  if (await getSessionUser()) redirect("/s");
  const groupId = await readInviteGroupId();
  if (!groupId) redirect("/enter");
  const { u } = await searchParams;
  if (!u) redirect("/enter/who");

  const [user] = await db
    .select({ id: users.id, fullName: users.fullName, avatarEmoji: users.avatarEmoji, color: users.color, pinHash: users.pinHash })
    .from(users)
    .where(and(eq(users.id, u), eq(users.groupId, groupId), eq(users.status, "active")));
  if (!user) redirect("/enter/who");

  const claimed = Boolean(user.pinHash);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Avatar user={user} size="lg" />
        <div>
          <div className="text-[13px] text-muted">{claimed ? "С возвращением" : "Привет"}</div>
          <div className="font-display text-xl font-bold">{user.fullName}</div>
        </div>
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-[28px] font-bold leading-tight">{claimed ? "Введи PIN" : "Придумай PIN"}</h1>
        <p className="text-[15px] text-muted">
          {claimed
            ? "Четыре цифры, которые ты задал при первом входе."
            : "Четыре цифры. Нужны, чтобы никто не зашёл под твоим именем с другого телефона."}
        </p>
      </div>
      <PinForm userId={user.id} claimed={claimed} />
    </div>
  );
}
