import Link from "next/link";
import { and, count, eq, desc } from "drizzle-orm";
import { CalendarPlus, ChevronRight, DatabaseBackup, KeyRound, Users2, BookMarked, Wallet } from "lucide-react";
import { lastBackup, polzaBalance } from "@/lib/admin/status";
import { storage } from "@/lib/storage";
import { db } from "@/lib/db";
import { groups, subjects, users, weeks } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { mondayIso, addDaysIso } from "@/lib/tz";
import { fmtRangeShort } from "@/lib/schedule/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/primitives";

export default async function AdminHome() {
  const user = await requireRole("moderator");
  const [group] = await db.select().from(groups).where(eq(groups.id, user.groupId));
  const [{ people }] = await db.select({ people: count() }).from(users).where(and(eq(users.groupId, user.groupId), eq(users.status, "active")));
  const [{ subj }] = await db.select({ subj: count() }).from(subjects).where(and(eq(subjects.groupId, user.groupId), eq(subjects.archived, false)));
  const recent = await db.select().from(weeks).where(eq(weeks.groupId, user.groupId)).orderBy(desc(weeks.startsOn)).limit(3);
  const thisMonday = mondayIso();
  const nextMonday = addDaysIso(thisMonday, 7);
  const current = recent.find((w) => w.startsOn === thisMonday);
  const next = recent.find((w) => w.startsOn === nextMonday);
  const [polza, backup] = user.role === "admin" ? await Promise.all([polzaBalance(), lastBackup()]) : [null, null];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-bold leading-none">Обзор</h1>

      {user.role === "admin" && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-display text-lg font-bold">Расписание</div>
            <Link href="/admin/schedule" className="text-[13px] font-medium text-muted">Все недели</Link>
          </div>
          <WeekLine label="Эта неделя" monday={thisMonday} week={current} />
          <WeekLine label="Следующая" monday={nextMonday} week={next} />
          <Link href="/admin/schedule/new" className="flex items-center justify-center gap-2 rounded-full bg-accent py-3 font-semibold text-accent-ink active:bg-accent-press">
            <CalendarPlus className="size-4" /> Новая неделя
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Tile href="/admin/users" icon={<Users2 className="size-5" />} label="Люди" value={String(people)} />
        <Tile href="/admin/subjects" icon={<BookMarked className="size-5" />} label="Предметы" value={String(subj)} />
      </div>

      {user.role === "admin" && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <div className="flex items-center gap-2 text-muted">
              <Wallet className="size-4" /> <span className="text-[12px] font-medium">PolzaAI</span>
            </div>
            <div className="mt-2 font-display text-xl font-bold tnum">{polza?.balance !== null && polza?.balance !== undefined ? `${polza.balance.toFixed(0)} ₽` : "—"}</div>
            <div className="truncate text-[11px] text-dim">{polza?.error ?? "остаток на распознавание"}</div>
          </Card>
          <Card>
            <div className="flex items-center gap-2 text-muted">
              <DatabaseBackup className="size-4" /> <span className="text-[12px] font-medium">Бэкап</span>
            </div>
            <div className="mt-2 font-display text-xl font-bold tnum">{backup ?? "нет"}</div>
            <div className="truncate text-[11px] text-dim">{storage.kind === "r2" ? "ежедневно в R2" : "локальная папка"}</div>
          </Card>
        </div>
      )}

      {user.role === "admin" && (
        <Card className="flex items-center gap-3">
          <KeyRound className="size-5 text-accent" />
          <div className="flex-1">
            <div className="text-[13px] text-muted">Инвайт-код группы</div>
            <div className="font-display text-xl font-bold tracking-wider">{group?.inviteCode}</div>
          </div>
          <Link href="/admin/settings" className="text-[13px] font-medium text-muted">Сменить</Link>
        </Card>
      )}
    </div>
  );
}

function WeekLine({ label, monday, week }: { label: string; monday: string; week?: { id: string; status: "draft" | "published" } }) {
  return (
    <Link href={week ? `/admin/schedule/${week.id}` : `/admin/schedule/new?startsOn=${monday}`} className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2.5 active:bg-surface-3">
      <div className="flex-1">
        <div className="text-[12px] text-muted">{label}</div>
        <div className="font-medium">{fmtRangeShort(monday, addDaysIso(monday, 5))}</div>
      </div>
      {week ? <Badge tone={week.status === "published" ? "ok" : "warn"}>{week.status === "published" ? "опубликована" : "черновик"}</Badge> : <Badge tone="danger">нет</Badge>}
      <ChevronRight className="size-4 text-dim" />
    </Link>
  );
}

function Tile({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) {
  return (
    <Link href={href} className="rounded-lg bg-surface p-4 hairline active:bg-surface-2">
      <div className="text-muted">{icon}</div>
      <div className="mt-3 font-display text-2xl font-bold tnum">{value}</div>
      <div className="text-[13px] text-muted">{label}</div>
    </Link>
  );
}
