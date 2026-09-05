import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { asUuid } from "@/lib/utils";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subjects } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { toggleSubjectArchived, updateSubject } from "@/app/admin/actions/catalog";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ConfirmButton, SubmitButton } from "@/components/admin/forms";

export default async function EditSubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  const id = asUuid((await params).id);
  if (!id) notFound();
  const [s] = await db.select().from(subjects).where(and(eq(subjects.id, id), eq(subjects.groupId, admin.groupId)));
  if (!s) notFound();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-[24px] font-bold leading-tight">{s.name}</h1>
      <Card>
        <ActionForm action={updateSubject.bind(null, s.id)} className="space-y-3">
          <Field label="Название">
            <Input name="name" defaultValue={s.name} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Коротко">
              <Input name="shortName" defaultValue={s.shortName ?? ""} />
            </Field>
            <Field label="Цвет">
              <Input type="color" name="color" defaultValue={s.color ?? "#8FA6FF"} className="h-12 p-1" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Преподаватель">
              <Input name="defaultTeacher" defaultValue={s.defaultTeacher ?? ""} />
            </Field>
            <Field label="Аудитория">
              <Input name="defaultRoom" defaultValue={s.defaultRoom ?? ""} />
            </Field>
          </div>
          <Field label="Как пишут в расписании" hint="По одному в строке. Пополняется само, когда в черновике скана строку привязывают к этому предмету.">
            <Textarea name="aliases" defaultValue={s.aliases.join("\n")} placeholder={"Матан\nМатем. анализ"} className="min-h-20" />
          </Field>
          <SubmitButton className="w-full">Сохранить</SubmitButton>
        </ActionForm>
      </Card>
      <ConfirmButton
        variant={s.archived ? "outline" : "secondary"}
        className="w-full"
        confirmText={s.archived ? "Вернуть предмет в справочник?" : "Убрать в архив? В расписании и домашке он останется, но выбрать его будет нельзя."}
        action={toggleSubjectArchived.bind(null, s.id)}
      >
        {s.archived ? "Вернуть из архива" : "В архив"}
      </ConfirmButton>
    </div>
  );
}
