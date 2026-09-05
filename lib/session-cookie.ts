// Сессионная cookie: имя, срок и опции. Модуль без node-зависимостей — его импортирует middleware
// (edge runtime, туда нельзя тянуть pg и lib/db), поэтому константы живут здесь, а не в lib/auth.
export const SESSION_COOKIE = "raspison_session";
/** 12 месяцев; middleware продлевает скользяще на каждом заходе. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});
