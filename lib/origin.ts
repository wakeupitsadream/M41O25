/**
 * Рабочий адрес приложения и ответ на вопрос «а с того ли адреса это открыто».
 *
 * У каждой ветки на Vercel есть preview-адрес, внешне неотличимый от рабочего. Установленная на iPhone PWA
 * навсегда привязана к тому адресу, с которого её поставили, и умирает молча, когда из окружения Preview
 * убирают DATABASE_URL. Поэтому предупреждаем до установки и даём уйти на рабочий адрес одним тапом.
 *
 * Пустая переменная = проверка выключена: локальная разработка, тесты и e2e плашку видеть не должны.
 */
export const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "";

/**
 * Origin в каноническом виде: нижний регистр, без пути и завершающего слэша, без порта по умолчанию
 * (`https://a:443` и `https://A/` — один и тот же адрес). Схему можно не писать: `raspison.vercel.app`
 * читается как `https://raspison.vercel.app`. Мусор и не-http (`file:`, `capacitor:`) → null.
 */
export function canonicalOrigin(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return `${url.protocol}//${url.host}`.toLowerCase();
}

export type OriginStatus =
  /** Проверять нечего или нечем: переменная пуста либо текущий адрес не разобрался. Молчим. */
  | { kind: "off" }
  | { kind: "same" }
  | { kind: "foreign"; expected: string; host: string };

/** Сравнение «где мы» с «где надо». Никаких исключений: непонятный вход — это `off`, а не ложная тревога. */
export function originStatus(expected: string | null | undefined, current: string | null | undefined): OriginStatus {
  const want = canonicalOrigin(expected);
  if (!want) return { kind: "off" };
  const have = canonicalOrigin(current);
  if (!have) return { kind: "off" };
  if (have === want) return { kind: "same" };
  return { kind: "foreign", expected: want, host: want.replace(/^https?:\/\//, "") };
}

/**
 * Тот же путь на рабочем адресе. Путь приходит из `location`, поэтому ведущие слэши и обратные слэши
 * схлопываем: `//раздел` иначе превратился бы в ссылку на чужой домен.
 */
export function hrefOnOrigin(origin: string, pathWithQuery: string): string {
  const base = canonicalOrigin(origin);
  if (!base) return pathWithQuery || "/";
  return `${base}/${pathWithQuery.replace(/^[\\/]+/, "")}`;
}
