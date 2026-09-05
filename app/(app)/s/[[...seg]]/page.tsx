import { requireUser } from "@/lib/auth";
import { getSchedulePayload } from "@/lib/schedule/query";
import { addDaysIso, hmToMinutes, nowHm, todayIso } from "@/lib/tz";
import { weatherAdvice, weatherAt } from "@/lib/weather";
import { ScheduleApp, type WeatherLine } from "@/components/schedule/schedule-app";

export const metadata = { title: "Расписание" };
export const dynamic = "force-dynamic";

/** Ближайшая пара (сегодня, если ещё не началась первая, иначе завтра/послезавтра) → строка с погодой к её началу. */
async function weatherLine(payload: Awaited<ReturnType<typeof getSchedulePayload>>): Promise<WeatherLine | null> {
  const today = todayIso();
  const nowMin = hmToMinutes(nowHm());
  const all = payload.weeks.flatMap((w) => w.lessons).filter((l) => !l.isCancelled);
  const labels = ["Сегодня", "Завтра", "Послезавтра"];
  for (let i = 0; i < 3; i++) {
    const date = addDaysIso(today, i);
    const first = all.filter((l) => l.date === date).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    if (!first) continue;
    if (i === 0 && hmToMinutes(first.startsAt) <= nowMin) continue;
    const w = await weatherAt(date, first.startsAt);
    if (!w) return null;
    return { text: `${labels[i]} к ${first.startsAt}: ${w.temp > 0 ? "+" : ""}${w.temp}°, ${weatherAdvice(w)}`, emoji: w.emoji };
  }
  return null;
}

export default async function SchedulePage() {
  const user = await requireUser();
  const payload = await getSchedulePayload(user.groupId, user.id);
  const weather = await weatherLine(payload);
  return <ScheduleApp initialData={payload} serverToday={todayIso()} weather={weather} />;
}
