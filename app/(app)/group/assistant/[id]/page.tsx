import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isAccessActive } from "@/lib/assistant/access";
import { loadConversationFor } from "@/lib/assistant/conversations";
import { buildState, getSettings } from "@/lib/assistant/store";
import { asUuid } from "@/lib/utils";
import { ChatScreen } from "@/components/assistant/chat-screen";
import type { ChatInitial } from "@/components/assistant/use-chat";

export const metadata = { title: "Помощник" };
export const dynamic = "force-dynamic";

/**
 * Экран беседы. /group/assistant/new — пустая беседа: id появится после первого ответа сервера (событие start),
 * и клиент сам поменяет адрес через history.replaceState, не перемонтируя экран.
 */
export default async function AssistantChatPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // Выключенный помощник объясняет себя в разделе; здесь ему показывать нечего.
  if (!getSettings(user.group).enabled) redirect("/group/assistant");

  const isNew = id === "new";
  const cid = isNew ? null : asUuid(id);
  if (!isNew && !cid) notFound();
  const [state, found] = await Promise.all([buildState(user), cid ? loadConversationFor(cid, user) : null]);
  if (cid && !found) notFound();
  // Новую беседу без доступа начать нельзя — в разделе кнопка триала или «Как оплатить». Старые беседы читать можно.
  if (isNew && !isAccessActive(state.access)) redirect("/group/assistant");
  const initial: ChatInitial = found ?? { conversation: null, messages: [] };

  // userId — для черновика в localStorage: на общем устройстве следующий вошедший не получит чужой недописанный вопрос.
  return <ChatScreen key={id} initial={initial} assistant={state} userId={user.id} />;
}
