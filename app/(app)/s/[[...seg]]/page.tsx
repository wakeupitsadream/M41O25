import { requireUser } from "@/lib/auth";
import { getSchedulePayload } from "@/lib/schedule/query";
import { addDaysIso, hmToMinutes, nowHm, todayIso } from "@/lib/tz";
import { loadForecast, pickHour, weatherAdvice, type Forecast } from "@/lib/weather";
import { ScheduleApp, type WeatherLine } from "@/components/schedule/schedule-app";

export const metadata = { title: "Расписание" };
export const dynamic = "force-dynamic";

/** Ближайшая пара (сегодня, если ещё не началась первая, иначе завтра/послезавтра) → строка с погодой к её началу. */
function weatherLine(payload: Awaited<ReturnType<typeof getSchedulePayload>>, forecast: Forecast | null): WeatherLine | null {
  if (!forecast) return null;
  const today = todayIso();
  const nowMin = hmToMinutes(nowHm());
  const all = payload.weeks.flatMap((w) => w.lessons).filter((l) => !l.isCancelled);
  const labels = ["Сегодня", "Завтра", "Послезавтра"];
  for (let i = 0; i < 3; i++) {
    const date = addDaysIso(today, i);
    const first = all.filter((l) => l.date === date).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    if (!first) continue;
    if (i === 0 && hmToMinutes(first.startsAt) <= nowMin) continue;
    const w = pickHour(forecast, date, first.startsAt);
    if (!w) return null;
    return { text: `${labels[i]} к ${first.startsAt}: ${w.temp > 0 ? "+" : ""}${w.temp}°, ${weatherAdvice(w)}`, emoji: w.emoji };
  }
  return null;
}

/**
 * Сколько главный экран готов ждать прогноз сверх запросов к базе. Прогноз идёт параллельно с базой и при тёплом
 * Data Cache успевает всегда; холодный запрос к Open-Meteo (первый в каждый час, каждый холодный инстанс) мог
 * добавлять до 1,5 с к первому байту — строка погоды того не стоит. Сам fetch при этом доходит до конца и
 * кладёт ответ в кеш для следующего захода.
 */
const WEATHER_WAIT_MS = 600;

export default async function SchedulePage() {
  const user = await requireUser();
  const forecastPromise = loadForecast();
  const payload = await getSchedulePayload(user.groupId, user.id);
  const forecast = await Promise.race([forecastPromise, new Promise<null>((r) => setTimeout(() => r(null), WEATHER_WAIT_MS))]);
  return <ScheduleApp initialData={payload} serverToday={todayIso()} weather={weatherLine(payload, forecast)} />;
}
