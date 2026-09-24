import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildState } from "@/lib/assistant/store";
import type { AssistantState } from "@/lib/assistant/types";

/*
 * GET /api/assistant/state — доступ, остатки лимитов и ресурса для экрана чата (после ответа, ошибки, «Стоп»).
 * Роут, а не server action getAssistantState — по той же причине, что и GET беседы (conversations/[id]/route.ts):
 * ответ server action с переустановленной proxy.ts cookie перерисовывает страницу и перемонтирует экран чата.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Нужно войти заново" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const state: AssistantState = await buildState(user);
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
