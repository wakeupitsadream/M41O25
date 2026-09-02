import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { SubHeader } from "@/components/group/sub-header";
import { Roulette } from "@/components/group/roulette";

export const metadata = { title: "Кто отвечает" };
export const dynamic = "force-dynamic";

export default async function RoulettePage() {
  const user = await requireUser();
  const people = await db
    .select({ id: users.id, fullName: users.fullName, avatarEmoji: users.avatarEmoji, color: users.color })
    .from(users)
    .where(and(eq(users.groupId, user.groupId), eq(users.status, "active")))
    .orderBy(asc(users.fullName));
  return (
    <>
      <SubHeader title="Кто отвечает" subtitle="честный рандом для докладов и дежурств" />
      <div className="px-5 pb-6">
        <Roulette people={people} />
      </div>
    </>
  );
}
