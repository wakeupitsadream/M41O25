import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "raspison_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

// Публичные пути: вход, служебные файлы PWA, cron, статика.
const PUBLIC = [/^\/enter(\/|$)/, /^\/~offline$/, /^\/api\/auth\//, /^\/api\/cron\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//, /^\/favicon\.ico$/];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const isPublic = PUBLIC.some((re) => re.test(pathname));

  if (!token) {
    if (isPublic || req.headers.get("next-action")) return NextResponse.next();
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/enter";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Скользящее продление: cookie переустанавливается с новым сроком на каждом заходе,
  // валидность самого токена проверяет сервер (requireUser) по базе.
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)"],
};
