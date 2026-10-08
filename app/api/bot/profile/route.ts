import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, subjects } from "@/lib/db/schema";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Сравнение ключа без утечки по времени — как у cron: хеши одинаковой длины, timingSafeEqual. */
function authorized(header: string | null): boolean {
  if (!env.botApiKey || !header) return false;
  const given = createHash("sha256").update(header).digest();
  const want = createHash("sha256").update(`Bearer ${env.botApiKey}`).digest();
  return timingSafeEqual(given, want);
}

/**
 * Профиль для личного бота в MAX (max-bot/): шифр группы и список предметов — модель лучше понимает, о каком
 * курсе вопрос. Преподаватели, аудитории и люди сюда не попадают: бот передаёт профиль внешним моделям.
 * Без BOT_API_KEY роут выключен (404). Групп несколько — бот передаёт ?group=<шифр>.
 */
export async function GET(req: Request) {
  if (!env.botApiKey) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const wanted = (new URL(req.url).searchParams.get("group") ?? "").trim().toLowerCase();
  const all = await db
    .select({ id: groups.id, name: groups.name, shortName: groups.shortName })
    .from(groups)
    .orderBy(asc(groups.createdAt));
  const group = wanted ? all.find((g) => g.shortName.toLowerCase() === wanted) : all.length === 1 ? all[0] : undefined;
  if (!group) {
    return NextResponse.json(
      { error: wanted ? "группа не найдена" : "групп несколько — передай ?group=<шифр>", groups: all.map((g) => g.shortName) },
      { status: wanted ? 404 : 409 },
    );
  }
  const rows = await db
    .select({ name: subjects.name, shortName: subjects.shortName })
    .from(subjects)
    .where(and(eq(subjects.groupId, group.id), eq(subjects.archived, false)))
    .orderBy(asc(subjects.name));
  return NextResponse.json(
    { group: { name: group.name, shortName: group.shortName }, subjects: rows },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
