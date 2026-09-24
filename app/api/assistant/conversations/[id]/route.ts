import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { asUuid } from "@/lib/utils";
import { findOwnConversation, loadMessages, toConversationInfo } from "@/lib/assistant/store";
import type { ChatMessage, ConversationInfo } from "@/lib/assistant/types";

/*
 * GET /api/assistant/conversations/[id] — беседа с сообщениями для экрана чата (перечитать после обрыва стрима).
 * Роут, а не server action getConversation: ответ server action проходит через proxy.ts, который на каждом запросе
 * переустанавливает cookie сессии; Next считает это правкой cookie, отвечает x-action-revalidated и перерисовывает
 * страницу — у нового чата после replaceState это перемонтирование экрана с потерей показанного куска и «Повторить».
 * Роут-хендлер роутер не трогает. Service worker /api/* (кроме расписания) не кеширует, а no-store — для браузера.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { conversation: ConversationInfo; messages: ChatMessage[] } | { error: string };

const json = (body: Body, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return json({ error: "Нужно войти заново" }, 401);
  const id = asUuid((await params).id);
  // Чужая и несуществующая — одинаковый 404: по ответу не узнать, что такой id у кого-то есть.
  const conversation = id ? await findOwnConversation(id, user) : null;
  if (!conversation) return json({ error: "Беседа не найдена" }, 404);
  return json({ conversation: toConversationInfo(conversation), messages: await loadMessages(conversation.id, user.id) }, 200);
}
