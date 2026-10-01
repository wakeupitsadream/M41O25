import { requireUser } from "@/lib/auth";
import { listBirthdays, sectionLatest } from "@/lib/group/query";
import { todayIso } from "@/lib/tz";
import { firstName } from "@/lib/utils";
import { TabBar } from "@/components/features/tab-bar";
import { BirthdayBanner } from "@/components/group/birthday-banner";
import { RefreshOnResume } from "@/components/features/refresh-on-resume";
import { AppBadge } from "@/components/features/app-badge";
import { NetStatus } from "@/components/features/net-status";
import { HwOutbox } from "@/components/hw/hw-outbox";
import { WrongOriginBanner } from "@/components/features/wrong-origin";
import { ToastProvider } from "@/components/ui/toast";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const today = todayIso();
  const [latest, birthdays] = await Promise.all([sectionLatest(user.groupId, user.id, user.feedSeenAt), listBirthdays(user.groupId, today)]);
  const todays = birthdays.filter((b) => b.daysUntil === 0).map((b) => ({ id: b.id, fullName: b.fullName, firstName: firstName(b.fullName) }));

  return (
    <ToastProvider>
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <RefreshOnResume />
        <AppBadge />
        {/*
          Одна колонка на все верхние плашки: раскладку держит контейнер, а WrongOriginBanner, NetStatus, HwOutbox
          и BirthdayBanner не знают друг о друге и не считают отступы — иначе они наезжают друг на друга в любой
          новой комбинации. Сам контейнер тапы не ловит, интерактивные плашки внутри включают pointer-events сами.
          Порядок сверху вниз — по серьёзности: чужой адрес значит, что всё остальное скоро перестанет работать.
          Колонка в потоке и прилипает к верху (sticky), а не fixed: страница сдвигается под плашки, а не прячется
          под ними («‹ Неделя», «Архив», «+ Опрос» оставались под баннером ДР). Отступ под статус-бар уже даёт
          pt-safe у шапок, поэтому отрицательный нижний margin отдаёт его обратно — без двойного зазора; когда все
          плашки вернули null, колонка пуста и скрыта (empty:hidden), и ничего не сдвигается.
        */}
        <div
          className="pointer-events-none sticky top-0 z-30 flex w-full flex-col items-center gap-1.5 px-4 empty:hidden"
          style={{ paddingTop: "calc(var(--sat) + 0.5rem)", marginBottom: "calc(var(--sat) * -1)" }}
        >
          <WrongOriginBanner />
          <NetStatus />
          <HwOutbox meId={user.id} />
          <BirthdayBanner today={today} people={todays} meId={user.id} />
        </div>
        <div className="flex-1 pb-safe">{children}</div>
        <TabBar latest={latest} feedSeenAt={user.feedSeenAt?.toISOString() ?? null} />
      </div>
    </ToastProvider>
  );
}
