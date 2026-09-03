import { notFound } from "next/navigation";
import { asUuid } from "@/lib/utils";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceSessions, users } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { resetPin, revokeSessions, setUserStatus, updateUser } from "@/app/admin/actions/users";
import { UserForm } from "@/components/admin/user-form";
import { ConfirmButton } from "@/components/admin/forms";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/primitives";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  const id = asUuid((await params).id);
  if (!id) notFound();
  const [u] = await db.select().from(users).where(and(eq(users.id, id), eq(users.groupId, admin.groupId)));
  if (!u) notFound();
  const [{ sessions }] = await db.select({ sessions: count() }).from(deviceSessions).where(and(eq(deviceSessions.userId, id), isNull(deviceSessions.revokedAt)));
  const isSelf = u.id === admin.id;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar user={u} size="lg" />
        <div>
          <h1 className="font-display text-[24px] font-bold leading-none">{u.fullName}</h1>
          <div className="mt-1 text-[13px] text-muted">
            {u.pinHash ? "PIN задан" : "ещё не входил"} · устройств: {sessions}
          </div>
        </div>
      </div>

      <Card>
        <UserForm
          action={updateUser.bind(null, u.id)}
          values={{ fullName: u.fullName, nickname: u.nickname, avatarEmoji: u.avatarEmoji, color: u.color, role: u.role, birthday: u.birthday }}
          isSelf={isSelf}
          submitLabel="Сохранить"
        />
      </Card>

      <Card className="space-y-2">
        <div className="font-display text-[16px] font-bold">Доступ</div>
        <p className="text-[13px] text-muted">Сброс PIN разлогинит человека везде и позволит задать новый PIN при входе. Если кто-то занял чужой профиль — это и есть лекарство.</p>
        <div className="grid grid-cols-2 gap-2">
          {!isSelf && (
            <ConfirmButton variant="secondary" confirmText={`Сбросить PIN у ${u.fullName}?`} action={resetPin.bind(null, u.id)}>
              Сбросить PIN
            </ConfirmButton>
          )}
          <ConfirmButton variant="secondary" confirmText="Выйти на всех устройствах этого человека?" action={revokeSessions.bind(null, u.id)}>
            Выйти везде
          </ConfirmButton>
        </div>
        {!isSelf &&
          (u.status === "active" ? (
            <ConfirmButton variant="danger" className="w-full" confirmText="Удалить из группы? Его записи останутся, вход закроется." action={setUserStatus.bind(null, u.id, "removed")}>
              Удалить из группы
            </ConfirmButton>
          ) : (
            <ConfirmButton variant="outline" className="w-full" confirmText="Вернуть в группу?" action={setUserStatus.bind(null, u.id, "active")}>
              Вернуть в группу
            </ConfirmButton>
          ))}
      </Card>
    </div>
  );
}
