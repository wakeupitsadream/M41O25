import { requireUser } from "@/lib/auth";
import { listBirthdays, sectionLatest } from "@/lib/group/query";
import { todayIso } from "@/lib/tz";
import { firstName } from "@/lib/utils";
import { TabBar } from "@/components/features/tab-bar";
import { BirthdayBanner } from "@/components/group/birthday-banner";
import { RefreshOnResume } from "@/components/features/refresh-on-resume";
import { NetStatus } from "@/components/features/net-status";
import { NavWatchdog } from "@/components/features/nav-guard";
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
        <NetStatus />
        <BirthdayBanner today={today} people={todays} meId={user.id} />
        <div className="flex-1 pb-safe">{children}</div>
        <TabBar latest={latest} feedSeenAt={user.feedSeenAt?.toISOString() ?? null} />
      </div>
    </ToastProvider>
  );
}
