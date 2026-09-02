import Link from "next/link";
import { BookOpen, CalendarDays, CheckSquare, MessageCircle, MessageCircleQuestion, Newspaper, PencilLine, Vote } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listFeed, type FeedItem } from "@/lib/group/query";
import { fmtDateTime } from "@/lib/hw/format";
import { fmtRangeShort, addDaysIso } from "@/lib/schedule/time";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { SubHeader } from "@/components/group/sub-header";
import { MarkSeen } from "@/components/group/mark-seen";
import { cn, displayName } from "@/lib/utils";

export const metadata = { title: "Что нового" };
export const dynamic = "force-dynamic";

function describe(e: FeedItem): { icon: React.ElementType; text: string; href: string | null } {
  const p = e.payload as Record<string, string | null | undefined>;
  switch (e.eventType) {
    case "hw_added":
      return { icon: BookOpen, text: `добавил ДЗ: «${p.title ?? ""}»`, href: e.entityId ? `/hw/${e.entityId}` : "/hw" };
    case "hw_edit_added":
      return { icon: PencilLine, text: `дополнил ДЗ: «${p.text ?? ""}»`, href: e.entityId ? `/hw/${e.entityId}` : "/hw" };
    case "comment_added":
      return { icon: MessageCircle, text: `уточнил по ДЗ: «${p.text ?? ""}»`, href: e.entityId ? `/hw/${e.entityId}` : "/hw" };
    case "schedule_published":
      return { icon: CalendarDays, text: `опубликовал расписание на ${p.startsOn ? fmtRangeShort(p.startsOn, addDaysIso(p.startsOn, 5)) : "неделю"}`, href: p.startsOn ? `/s/w/${p.startsOn}` : "/s" };
    case "schedule_changed":
      return { icon: CalendarDays, text: `изменил пару ${p.title ?? ""} (${p.date ?? ""})`, href: p.date ? `/s/d/${p.date}` : "/s" };
    case "lesson_cancelled":
      return { icon: CalendarDays, text: `отменил пару ${p.title ?? ""} (${p.date ?? ""})`, href: p.date ? `/s/d/${p.date}` : "/s" };
    case "lesson_restored":
      return { icon: CalendarDays, text: `вернул пару ${p.title ?? ""} (${p.date ?? ""})`, href: p.date ? `/s/d/${p.date}` : "/s" };
    case "news_added":
      return { icon: Newspaper, text: `написал новость: «${p.title ?? ""}»`, href: "/group/news" };
    case "task_added":
      return { icon: CheckSquare, text: `завёл задачу: «${p.title ?? ""}»`, href: e.entityId ? `/group/tasks/${e.entityId}` : "/group/tasks" };
    case "poll_created":
      return { icon: Vote, text: `создал опрос: «${p.question ?? ""}»`, href: "/group/polls" };
    case "anon_question":
      return { icon: MessageCircleQuestion, text: "Новый анонимный вопрос", href: "/group/questions" };
    case "anon_answered":
      return { icon: MessageCircleQuestion, text: `ответил на анонимный вопрос`, href: "/group/questions" };
    default:
      return { icon: Newspaper, text: e.eventType, href: null };
  }
}

export default async function FeedPage() {
  const user = await requireUser();
  const items = await listFeed(user.groupId, user.id);
  const seen = user.feedSeenAt?.getTime() ?? 0;

  return (
    <>
      <SubHeader title="Что нового" subtitle="с твоего последнего захода" />
      <MarkSeen />
      <div className="px-5">
        {items.length === 0 && <EmptyState emoji="🌙" title="Пока тихо" text="Здесь появятся новые ДЗ, замены в расписании, новости и опросы." />}
        <ul className="space-y-2">
          {items.map((e) => {
            const d = describe(e);
            const isNew = new Date(e.createdAt).getTime() > seen;
            const Icon = d.icon;
            const inner = (
              <div className={cn("flex items-start gap-3 rounded-lg bg-surface p-3.5 hairline", isNew && "ring-1 ring-accent/30")}>
                {e.actor ? <Avatar user={e.actor} size="sm" /> : <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"><Icon className="size-4" /></span>}
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] leading-snug">
                    {e.actor && <span className="font-semibold">{displayName(e.actor)} </span>}
                    <span className={e.actor ? "text-fg" : "font-semibold"}>{d.text}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-dim">
                    <Icon className="size-3" /> {fmtDateTime(e.createdAt)}
                    {isNew && <span className="ml-1 size-1.5 rounded-full bg-accent" />}
                  </div>
                </div>
              </div>
            );
            return <li key={e.id}>{d.href ? <Link href={d.href}>{inner}</Link> : inner}</li>;
          })}
        </ul>
      </div>
    </>
  );
}
