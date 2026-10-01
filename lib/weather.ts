import "server-only";
import { env } from "@/lib/env";

// Оренбург. Open-Meteo: бесплатно, без ключа, из РФ доступен. Кеш на час через fetch revalidate.
const LAT = 51.7727;
const LON = 55.0988;

export type WeatherPoint = { temp: number; code: number; precipProb: number; label: string; emoji: string };

const CODES: Array<[number[], string, string]> = [
  [[0], "ясно", "☀️"],
  [[1, 2], "переменная облачность", "🌤️"],
  [[3], "облачно", "☁️"],
  [[45, 48], "туман", "🌫️"],
  [[51, 53, 55, 56, 57], "морось", "🌦️"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "дождь", "🌧️"],
  [[71, 73, 75, 77, 85, 86], "снег", "❄️"],
  [[95, 96, 99], "гроза", "⛈️"],
];

const describe = (code: number) => CODES.find(([codes]) => codes.includes(code)) ?? [[], "пасмурно", "☁️"];

export type Forecast = { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: number[] };

let failedAt = 0;
const FAIL_MEMO_MS = 10 * 60_000;

/**
 * Почасовой прогноз на три дня (Data Cache на час). null — сервис недоступен; недавняя неудача помнится 10 минут,
 * чтобы главный экран не ждал мёртвый сервис. Отдельно от выбора часа: страница запускает его параллельно
 * с запросами к базе, а не после них.
 */
export async function loadForecast(): Promise<Forecast | null> {
  if (Date.now() - failedAt < FAIL_MEMO_MS) return null;
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(LAT));
    url.searchParams.set("longitude", String(LON));
    url.searchParams.set("hourly", "temperature_2m,weather_code,precipitation_probability");
    url.searchParams.set("timezone", env.tz);
    url.searchParams.set("forecast_days", "3");
    const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(1500) });
    if (!res.ok) {
      failedAt = Date.now();
      return null;
    }
    const json = (await res.json()) as { hourly?: Forecast };
    return json.hourly ?? null;
  } catch {
    failedAt = Date.now();
    return null;
  }
}

/** Погода в конкретный час (ISO-дата + «HH:MM») из готового прогноза. null — часа в прогнозе нет (дальше 2 дней). */
export function pickHour(forecast: Forecast | null, dateIso: string, hm: string): WeatherPoint | null {
  if (!forecast) return null;
  const key = `${dateIso}T${hm.slice(0, 2)}:00`;
  const i = forecast.time.indexOf(key);
  if (i < 0) return null;
  const code = forecast.weather_code[i];
  const [, label, emoji] = describe(code);
  return { temp: Math.round(forecast.temperature_2m[i]), code, precipProb: forecast.precipitation_probability[i] ?? 0, label, emoji };
}

/** Погода в конкретный час: прогноз + выбор часа одним вызовом (для тех, кому параллелить нечего). */
export async function weatherAt(dateIso: string, hm: string): Promise<WeatherPoint | null> {
  return pickHour(await loadForecast(), dateIso, hm);
}

/** Совет одной фразой — то, что реально хочется знать утром. */
export const weatherAdvice = (w: WeatherPoint) => {
  if (w.emoji === "❄️") return "снег, доставай зимнее";
  if (w.emoji === "⛈️" || w.emoji === "🌧️") return "дождь, бери зонт";
  if (w.temp <= -20) return "жёсткий мороз, одевайся по-максимуму";
  if (w.temp <= -10) return "холодно, шапка обязательна";
  if (w.temp <= 3) return "прохладно, куртка не помешает";
  if (w.temp >= 27) return "жара, вода с собой";
  if (w.precipProb >= 50) return "может пойти дождь";
  return w.label;
};
