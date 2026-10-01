import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { SESSION_COOKIE, cookieOptions } from "@/lib/session-cookie";

export const runtime = "nodejs";

/**
 * Сброс мёртвой cookie сессии (отозвана админом, истекла, профиль удалён): proxy.ts продлевает cookie
 * вслепую, поэтому без явной чистки устройство бесконечно ходило бы с бесполезным токеном.
 * Живую сессию роут не трогает: иначе ссылка /api/auth/clear в беседе разлогинивала бы любого тапнувшего.
 */
export async function GET(req: Request) {
  if (await getSessionUser()) return NextResponse.redirect(new URL("/s", req.url));
  const res = NextResponse.redirect(new URL("/enter?cleared=1", req.url));
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  return res;
}
