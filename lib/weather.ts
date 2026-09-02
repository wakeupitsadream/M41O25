import "server-only";

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

/** Погода в конкретный час (ISO-дата + «HH:MM») в поясе группы. null — если сервис недоступен или дата дальше 2 дней. */
export async function weatherAt(dateIso: string, hm: string): Promise<WeatherPoint | null> {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(LAT));
    url.searchParams.set("longitude", String(LON));
    url.searchParams.set("hourly", "temperature_2m,weather_code,precipitation_probability");
    url.searchParams.set("timezone", process.env.APP_TZ ?? "Asia/Yekaterinburg");
    url.searchParams.set("forecast_days", "3");
    const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { hourly?: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: number[] } };
    const h = json.hourly;
    if (!h) return null;
    const key = `${dateIso}T${hm.slice(0, 2)}:00`;
    const i = h.time.indexOf(key);
    if (i < 0) return null;
    const code = h.weather_code[i];
    const [, label, emoji] = describe(code);
    return { temp: Math.round(h.temperature_2m[i]), code, precipProb: h.precipitation_probability[i] ?? 0, label, emoji };
  } catch {
    return null;
  }
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
