import { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Сброс мёртвой cookie сессии (отозвана админом, истекла, профиль удалён): middleware продлевает cookie
 * вслепую, поэтому без явной чистки устройство бесконечно ходило бы с бесполезным токеном.
 */
export function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/enter?cleared=1", req.url));
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  return res;
}
