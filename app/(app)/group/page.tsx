import Link from "next/link";
import { Bell, Cake, CheckSquare, ChevronRight, Contact, MessageCircleQuestion, Newspaper, Vote } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { hubCounts, listBirthdays } from "@/lib/group/query";
import { todayIso } from "@/lib/tz";
import { PageHeader } from "@/components/ui/primitives";
import { firstName, cn, pluralRu } from "@/lib/utils";

export const metadata = { title: "Группа" };
export const dynamic = "force-dynamic";

export default async function GroupPage() {
  const user = await requireUser();
  const today = todayIso();
  const [counts, birthdays] = await Promise.all([hubCounts(user.groupId, user.id, user.feedSeenAt), listBirthdays(user.groupId, today)]);
  const nextBd = birthdays[0];
  const bdHint = !nextBd ? "пока пусто" : nextBd.daysUntil === 0 ? `сегодня у ${firstName(nextBd.fullName)} 🎉` : `${firstName(nextBd.fullName)} · через ${nextBd.daysUntil} ${pluralRu(nextBd.daysUntil, "день", "дня", "дней")}`;

  const tiles = [
    { href: "/group/news", icon: Newspaper, label: "Новости", hint: "объявления и закрепы", badge: null },
    { href: "/group/tasks", icon: CheckSquare, label: "Задачи", hint: counts.openTasks ? `${counts.openTasks} ${pluralRu(counts.openTasks, "открытая", "открытых", "открытых")}` : "всё сдано", badge: counts.openTasks || null },
    { href: "/group/polls", icon: Vote, label: "Опросы", hint: counts.openPolls ? `${counts.openPolls} ${pluralRu(counts.openPolls, "активный", "активных", "активных")}` : "создай первый", badge: counts.openPolls || null },
    { href: "/group/questions", icon: MessageCircleQuestion, label: "Анонимно", hint: counts.unanswered ? `${counts.unanswered} без ответа` : "спроси, не палясь", badge: null },
    { href: "/group/contacts", icon: Contact, label: "Контакты", hint: "преподаватели и деканат", badge: null },
    { href: "/group/birthdays", icon: Cake, label: "Дни рождения", hint: bdHint, badge: nextBd?.daysUntil === 0 ? "🎉" : null },
  ];

  return (
    <>
      <PageHeader title="Группа" subtitle={user.group.shortName} />
      <div className="space-y-3 px-5">
        <Link href="/group/feed" className={cn("flex items-center gap-3 rounded-lg p-4 hairline active:scale-[0.99]", counts.unread ? "bg-accent text-accent-ink shadow-glow" : "bg-surface")}>
          <Bell className="size-5" />
          <span className="flex-1">
            <span className="block font-display text-[16px] font-bold">Что нового</span>
            <span className={cn("block text-[13px]", counts.unread ? "text-accent-ink/70" : "text-muted")}>
              {counts.unread ? `${counts.unread} ${pluralRu(counts.unread, "событие", "события", "событий")} с твоего последнего захода` : "ты всё видел"}
            </span>
          </span>
          <ChevronRight className="size-4 opacity-60" />
        </Link>

        <div className="grid grid-cols-2 gap-3">
          {tiles.map((t) => (
            <Link key={t.href} href={t.href} className="relative rounded-lg bg-surface p-4 hairline active:bg-surface-2">
              <t.icon className="size-5 text-muted" />
              <div className="mt-3 font-display text-[16px] font-bold">{t.label}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-muted">{t.hint}</div>
              {t.badge !== null && (
                <span className="absolute right-3 top-3 grid min-w-6 place-items-center rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold text-accent-ink tnum">{t.badge}</span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
