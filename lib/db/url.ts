/**
 * Neon выдаёт строку с `sslmode=require`; node-postgres трактует require/prefer/verify-ca как verify-full
 * и печатает при каждом подключении «SECURITY WARNING». Переписываем режим явно — поведение то же, лог чистый.
 */
export function normalizeDatabaseUrl(url: string): string {
  if (/[?&]uselibpqcompat=/.test(url)) return url;
  return url.replace(/([?&])sslmode=(?:require|prefer|verify-ca)(?=&|$)/, "$1sslmode=verify-full");
}
