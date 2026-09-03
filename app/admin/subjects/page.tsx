import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { asc, eq } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { subjects } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { createSubject } from "@/app/admin/actions/catalog";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/forms";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export default async function AdminSubjects() {
  const admin = await requireRole("admin");
  const list = await db.select().from(subjects).where(eq(subjects.groupId, admin.groupId)).orderBy(asc(subjects.archived), asc(subjects.name));
  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-bold leading-none">Предметы</h1>
      <p className="text-[13px] text-muted">Справочник для расписания и домашки. Преподаватель и аудитория по умолчанию подставляются при добавлении пары.</p>
      <ul className="overflow-hidden rounded-lg bg-surface hairline">
        {list.map((s) => (
          <li key={s.id} className="border-b border-border last:border-0">
            <Link href={`/admin/subjects/${s.id}`} className={cn("flex items-center gap-3 px-4 py-3 active:bg-surface-2", s.archived && "opacity-50")}>
              <span className="size-3 shrink-0 rounded-full" style={{ background: s.color ?? "#62626e" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{s.name}</span>
                <span className="block truncate text-[12px] text-muted">{[s.shortName, s.defaultTeacher, s.defaultRoom].filter(Boolean).join(" · ")}</span>
              </span>
              {s.archived && <Badge>архив</Badge>}
              <ChevronRight className="size-4 text-dim" />
            </Link>
          </li>
        ))}
        {list.length === 0 && <li className="px-4 py-6 text-center text-muted">Пока пусто</li>}
      </ul>
      <Card>
        <ActionForm action={createSubject} className="space-y-3">
          <div className="font-display text-[16px] font-bold">Добавить предмет</div>
          <Field label="Название">
            <Input name="name" placeholder="Математический анализ" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Коротко">
              <Input name="shortName" placeholder="Матан" />
            </Field>
            <Field label="Цвет">
              <Input type="color" name="color" defaultValue="#8FA6FF" className="h-12 p-1" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Преподаватель">
              <Input name="defaultTeacher" placeholder="Иванова И.И." />
            </Field>
            <Field label="Аудитория">
              <Input name="defaultRoom" placeholder="214" />
            </Field>
          </div>
          <SubmitButton className="w-full">Добавить</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
