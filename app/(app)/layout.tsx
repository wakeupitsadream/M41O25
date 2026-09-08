import { requireUser } from "@/lib/auth";
import { listBirthdays, sectionLatest } from "@/lib/group/query";
import { todayIso } from "@/lib/tz";
import { firstName } from "@/lib/utils";
import { TabBar } from "@/components/features/tab-bar";
import { BirthdayBanner } from "@/components/group/birthday-banner";
import { RefreshOnResume } from "@/components/features/refresh-on-resume";
import { NetStatus } from "@/components/features/net-status";
import { NavWatchdog } from "@/components/features/nav-guard";
import { HwOutbox } from "@/components/hw/hw-outbox";
import { ToastProvider } from "@/components/ui/toast";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const today = todayIso();
  const [latest, birthdays] = await Promise.all([sectionLatest(user.groupId, user.id, user.feedSeenAt), listBirthdays(user.groupId, today)]);
  const todays = birthdays.filter((b) => b.daysUntil === 0).map((b) => ({ id: b.id, fullName: b.fullName, firstName: firstName(b.fullName) }));

  return (
    <ToastProvider>
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <NavWatchdog />
        <RefreshOnResume />
        {/*
          Одна колонка на все верхние плашки: раскладку держит контейнер, а NetStatus, HwOutbox и BirthdayBanner
          не знают друг о друге и не считают отступы — иначе они наезжают друг на друга в любой новой комбинации.
          Сам контейнер тапы не ловит, интерактивные плашки внутри включают pointer-events сами.
        */}
        <div
          className="pointer-events-none fixed inset-x-0 z-30 mx-auto flex w-full max-w-lg flex-col items-center gap-1.5 px-4"
          style={{ top: "calc(var(--sat) + 0.5rem)" }}
        >
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
