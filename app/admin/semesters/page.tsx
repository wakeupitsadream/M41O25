import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { semesters } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { createSemester, deleteSemester, updateSemester } from "@/app/admin/actions/catalog";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { ConfirmButton, SubmitButton } from "@/components/admin/forms";
import { todayIso } from "@/lib/tz";

export default async function AdminSemesters() {
  const admin = await requireRole("admin");
  const list = await db.select().from(semesters).where(eq(semesters.groupId, admin.groupId)).orderBy(asc(semesters.startsOn));
  const today = todayIso();
  const year = Number(today.slice(0, 4));

  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-bold leading-none">Семестры</h1>
      <p className="text-[13px] text-muted">Семестр задаёт сетку недель на экране «Семестр», счётчик до сессии и архив. Прошедшие семестры остаются в истории.</p>

      {list.map((s) => (
        <Card key={s.id}>
          <form action={updateSemester.bind(null, s.id)} className="space-y-3">
            <Field label="Название">
              <Input name="title" defaultValue={s.title} required />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Начало">
                <Input type="date" name="startsOn" defaultValue={s.startsOn} required className="px-2" />
              </Field>
              <Field label="Конец">
                <Input type="date" name="endsOn" defaultValue={s.endsOn} required className="px-2" />
              </Field>
              <Field label="Сессия с">
                <Input type="date" name="sessionStartsOn" defaultValue={s.sessionStartsOn ?? ""} className="px-2" />
              </Field>
            </div>
            <div className="flex gap-2">
              <SubmitButton className="flex-1">Сохранить</SubmitButton>
              <ConfirmButton variant="danger" confirmText="Удалить семестр? Недели останутся, но потеряют привязку." action={deleteSemester.bind(null, s.id)}>
                Удалить
              </ConfirmButton>
            </div>
          </form>
        </Card>
      ))}

      <Card>
        <form action={createSemester} className="space-y-3">
          <div className="font-display text-[16px] font-bold">Новый семестр</div>
          <Field label="Название">
            <Input name="title" placeholder={`Весна ${year + 1}`} required />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Начало">
              <Input type="date" name="startsOn" required className="px-2" />
            </Field>
            <Field label="Конец">
              <Input type="date" name="endsOn" required className="px-2" />
            </Field>
            <Field label="Сессия с">
              <Input type="date" name="sessionStartsOn" className="px-2" />
            </Field>
          </div>
          <SubmitButton className="w-full">Создать</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
