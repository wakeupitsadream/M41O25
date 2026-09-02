import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { rotateInviteCode, updateGroupName, updateSlotTimes } from "@/app/admin/actions/catalog";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { ConfirmButton, SubmitButton } from "@/components/admin/forms";

export default async function AdminSettings() {
  const admin = await requireRole("admin");
  const [group] = await db.select().from(groups).where(eq(groups.id, admin.groupId));
  const slots = Array.from({ length: 8 }, (_, i) => group.slotTimes.find((s) => s.slot === i + 1) ?? { slot: i + 1, start: "", end: "" });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-bold leading-none">Настройки</h1>

      <Card className="space-y-3">
        <div className="font-display text-[16px] font-bold">Инвайт-код</div>
        <div className="rounded-md bg-surface-2 px-4 py-3 text-center font-display text-2xl font-bold tracking-[0.2em]">{group.inviteCode}</div>
        <p className="text-[13px] text-muted">Кинь его в беседу группы. Смена кода не разлогинит тех, кто уже вошёл — код нужен только для входа.</p>
        <ConfirmButton variant="secondary" className="w-full" confirmText="Сменить код? Старый перестанет работать сразу." action={rotateInviteCode}>
          Сменить код
        </ConfirmButton>
      </Card>

      <Card>
        <form action={updateGroupName} className="space-y-3">
          <div className="font-display text-[16px] font-bold">Группа</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Шифр">
              <Input name="shortName" defaultValue={group.shortName} required />
            </Field>
            <Field label="Название">
              <Input name="name" defaultValue={group.name} />
            </Field>
          </div>
          <SubmitButton className="w-full" variant="secondary">
            Сохранить
          </SubmitButton>
        </form>
      </Card>

      <Card>
        <form action={updateSlotTimes} className="space-y-3">
          <div className="font-display text-[16px] font-bold">Время пар</div>
          <p className="text-[13px] text-muted">Подставляется при добавлении пары и распознавании скана. Пустые строки не учитываются.</p>
          <div className="space-y-2">
            {slots.map((s) => (
              <div key={s.slot} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-2">
                <span className="text-center font-semibold tnum">{s.slot}</span>
                <Input type="time" name={`start${s.slot}`} defaultValue={s.start} className="px-3" />
                <Input type="time" name={`end${s.slot}`} defaultValue={s.end} className="px-3" />
              </div>
            ))}
          </div>
          <SubmitButton className="w-full" variant="secondary">
            Сохранить
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
