import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { weeks } from "@/lib/db/schema";
import { addDaysIso, mondayIso } from "@/lib/tz";

/** Подсказка для формы «новая неделя»: следующий понедельник после последней недели и чётность наоборот. */
export async function suggestNextWeek(groupId: string) {
  const last = await db.select().from(weeks).where(eq(weeks.groupId, groupId)).orderBy(desc(weeks.startsOn)).limit(1);
  const startsOn = last[0] ? addDaysIso(last[0].startsOn, 7) : mondayIso();
  const parity: "upper" | "lower" | "none" = last[0]?.parity ? (last[0].parity === "upper" ? "lower" : "upper") : "none";
  const all = await db.select().from(weeks).where(eq(weeks.groupId, groupId)).orderBy(asc(weeks.startsOn));
  return { startsOn, parity, all };
}
