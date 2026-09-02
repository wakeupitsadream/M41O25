import { requireUser } from "@/lib/auth";
import { getSchedulePayload } from "@/lib/schedule/query";
import { todayIso } from "@/lib/tz";
import { ScheduleApp } from "@/components/schedule/schedule-app";

export const metadata = { title: "Расписание" };
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const user = await requireUser();
  const payload = await getSchedulePayload(user.groupId);
  return <ScheduleApp initialData={payload} serverToday={todayIso()} />;
}
