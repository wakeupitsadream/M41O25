// Сессионная cookie: имя, срок и опции. Модуль лёгкий и без обращений к базе — его импортирует proxy.ts,
// который в Next 16 всегда собирается в Node-рантайм (не edge), но тянуть туда pg и lib/db всё равно незачем:
// каждый запрос платил бы за подключение к базе. Поэтому константы живут здесь, а не в lib/auth.
export const SESSION_COOKIE = "raspison_session";
/** 12 месяцев; proxy.ts продлевает скользяще на каждом заходе. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});
