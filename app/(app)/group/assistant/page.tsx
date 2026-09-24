import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { isAccessActive } from "@/lib/assistant/access";
import { listConversationsFor } from "@/lib/assistant/conversations";
import { buildState, getSettings } from "@/lib/assistant/store";
import { APP_TZ, todayIso } from "@/lib/tz";
import { SubHeader } from "@/components/group/sub-header";
import { EmptyState } from "@/components/ui/primitives";
import { ConversationList } from "@/components/assistant/conversation-list";
import { HowItWorks } from "@/components/assistant/how-it-works";
import { LimitsBar } from "@/components/assistant/limits-bar";
import { StatusCard } from "@/components/assistant/status-card";

export const metadata = { title: "Помощник" };
export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const user = await requireUser();
  // Настройки уже в сессии (user.group): выключенный помощник не стоит ни одного запроса к базе.
  if (!getSettings(user.group).enabled) {
    return (
      <>
        <SubHeader title="Помощник" subtitle="по учёбе" />
        <EmptyState
          emoji="🤖"
          title="Помощник пока выключен"
          text="Когда админ его включит, здесь появится чат: объяснит тему, разберёт задачу по фото, подскажет по расписанию и домашке."
        />
      </>
    );
  }

  const [state, items] = await Promise.all([buildState(user), listConversationsFor(user)]);
  const active = isAccessActive(state.access);

  return (
    <>
      <SubHeader title="Помощник" subtitle="по учёбе" right={<HowItWorks limits={state.limits} />} />
      <div className="space-y-3 px-5">
        <StatusCard state={state} />
        {active && (
          <>
            <LimitsBar limits={state.limits} />
            <Link
              href="/group/assistant/new"
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-accent-ink shadow-[0_8px_24px_-10px_rgba(200,255,46,0.6)] active:scale-[0.98] active:bg-accent-press"
            >
              <Plus className="size-5" strokeWidth={2.6} /> Новый чат
            </Link>
          </>
        )}
        {items.length > 0 ? (
          <section className="pt-3">
            <h2 className="px-1 pb-2 text-[13px] font-medium uppercase tracking-wide text-muted">Беседы</h2>
            <ConversationList items={items} today={todayIso()} tz={APP_TZ} />
          </section>
        ) : (
          active && <p className="px-1 pt-2 text-center text-[14px] text-muted">Бесед пока нет — начни с вопроса про пары или тему, которую не понял.</p>
        )}
      </div>
    </>
  );
}
