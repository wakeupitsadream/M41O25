import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { buildBackup } from "@/lib/backup";
import { verifyScoped } from "@/lib/files/token";
import { asUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ручной бэкап админом — тот же JSON.gz, что складывает cron, но сразу на телефон или ноутбук.
 * Работает и без R2. Ссылка с токеном (?u=&t=) — для внешнего браузера из установленного PWA, где нет cookie.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = await getSessionUser();
  let allowed = session?.role === "admin";
  if (!allowed) {
    const uid = asUuid(url.searchParams.get("u") ?? "");
    if (uid && verifyScoped(`backup:${uid}`, url.searchParams.get("t"))) {
      const [u] = await db.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, uid));
      allowed = u?.role === "admin" && u.status === "active";
    }
  }
  if (!allowed) return NextResponse.json({ error: "Только админ" }, { status: 403 });

  const { key, payload } = await buildBackup();
  return new NextResponse(new Uint8Array(payload), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(payload.length),
      "Content-Disposition": `attachment; filename="raspison-${key.replace(/^backups\//, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
