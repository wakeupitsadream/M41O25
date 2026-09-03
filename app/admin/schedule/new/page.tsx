import { asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/ui/action-form";
import { db } from "@/lib/db";
import { semesters } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { suggestNextWeek } from "@/lib/admin/queries";
import { getCurrentSemester } from "@/lib/schedule/query";
import { createWeek } from "@/app/admin/actions/schedule";
import { addDaysIso, fmtRangeShort } from "@/lib/schedule/time";
import { Field, Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/forms";
import { Card } from "@/components/ui/card";

export default async function NewWeekPage({ searchParams }: { searchParams: Promise<{ startsOn?: string }> }) {
  const user = await requireRole("admin");
  const sp = await searchParams;
  const { startsOn, parity, all } = await suggestNextWeek(user.groupId);
  const semList = await db.select().from(semesters).where(eq(semesters.groupId, user.groupId)).orderBy(asc(semesters.startsOn));
  const current = await getCurrentSemester(user.groupId);
  const sameParity = all.filter((w) => w.parity === parity).at(-1);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-bold leading-none">Новая неделя</h1>
      <p className="text-[14px] text-muted">
        Создай неделю и заполни пары вручную или по скану. Дата — любой день нужной недели, понедельник посчитаю сам.
      </p>
      <Card>
        <ActionForm action={createWeek} className="space-y-4">
          <Field label="Неделя (любая дата внутри)">
            <Input type="date" name="startsOn" defaultValue={sp.startsOn ?? startsOn} required />
          </Field>
          <Field label="Чётность">
            <Select name="parity" defaultValue={parity}>
              <option value="upper">Верхняя</option>
              <option value="lower">Нижняя</option>
              <option value="none">Без чётности</option>
            </Select>
          </Field>
          <Field label="Семестр">
            <Select name="semesterId" defaultValue={current?.id ?? ""}>
              <option value="">—</option>
              {semList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Скопировать пары из недели" hint="Удобно, если расписание повторяется через неделю: скопируй последнюю той же чётности и поправь отличия.">
            <Select name="copyFrom" defaultValue={sameParity?.id ?? ""}>
              <option value="">Не копировать — пустая неделя</option>
              {[...all].reverse().map((w) => (
                <option key={w.id} value={w.id}>
                  {fmtRangeShort(w.startsOn, addDaysIso(w.startsOn, 5))}
                  {w.parity ? ` · ${w.parity === "upper" ? "верхняя" : "нижняя"}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <SubmitButton className="w-full" size="lg">
            Создать
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
