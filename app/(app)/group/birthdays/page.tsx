import { requireUser } from "@/lib/auth";
import { listBirthdays } from "@/lib/group/query";
import { todayIso } from "@/lib/tz";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { SubHeader } from "@/components/group/sub-header";
import { cn, pluralRu } from "@/lib/utils";

export const metadata = { title: "Дни рождения" };
export const dynamic = "force-dynamic";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export default async function BirthdaysPage() {
  const user = await requireUser();
  const list = await listBirthdays(user.groupId, todayIso());
  const soon = list.filter((b) => b.daysUntil <= 30);
  const later = list.filter((b) => b.daysUntil > 30);

  const Row = ({ b }: { b: (typeof list)[number] }) => {
    const [d, m] = b.monthDay.split(".").map(Number);
    const today = b.daysUntil === 0;
    return (
      <li className={cn("flex items-center gap-3 border-b border-border px-4 py-3 last:border-0", today && "bg-accent/10")}>
        <Avatar user={b} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{b.fullName}</span>
          <span className="block text-[12px] text-muted">
            {d} {MONTHS[m - 1]}
          </span>
        </span>
        <span className={cn("text-[13px] font-semibold tnum", today ? "text-accent" : b.daysUntil <= 7 ? "text-warn" : "text-muted")}>
          {today ? "сегодня 🎉" : b.daysUntil === 1 ? "завтра" : `через ${b.daysUntil} ${pluralRu(b.daysUntil, "день", "дня", "дней")}`}
        </span>
      </li>
    );
  };

  return (
    <>
      <SubHeader title="Дни рождения" subtitle={`${list.length} ${pluralRu(list.length, "человек", "человека", "человек")} указали дату`} />
      <div className="space-y-5 px-5">
        {list.length === 0 && <EmptyState emoji="🎂" title="Пока никто не указал" text="Дата рождения задаётся в профиле. Год можно поставить любой — показываем только день и месяц." />}
        {soon.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Ближайшие</h2>
            <ul className="overflow-hidden rounded-lg bg-surface hairline">{soon.map((b) => <Row key={b.id} b={b} />)}</ul>
          </section>
        )}
        {later.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Потом</h2>
            <ul className="overflow-hidden rounded-lg bg-surface hairline">{later.map((b) => <Row key={b.id} b={b} />)}</ul>
          </section>
        )}
        <p className="text-center text-[12px] text-dim">Свою дату можно добавить или убрать в профиле.</p>
      </div>
    </>
  );
}
