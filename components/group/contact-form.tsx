import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/forms";

type Values = { kind?: "teacher" | "dean" | "other"; name?: string; roleOrSubject?: string | null; phone?: string | null; email?: string | null; messenger?: string | null; note?: string | null };

export function ContactForm({ action, values, submitLabel }: { action: (fd: FormData) => Promise<void>; values?: Values; submitLabel: string }) {
  return (
    <form action={action} className="space-y-3">
      <Field label="Кто это">
        <Select name="kind" defaultValue={values?.kind ?? "teacher"}>
          <option value="teacher">Преподаватель</option>
          <option value="dean">Деканат / кафедра</option>
          <option value="other">Другое</option>
        </Select>
      </Field>
      <Field label="Имя / название">
        <Input name="name" defaultValue={values?.name ?? ""} placeholder="Иванова Ирина Ивановна" required />
      </Field>
      <Field label="Предмет или должность">
        <Input name="roleOrSubject" defaultValue={values?.roleOrSubject ?? ""} placeholder="Математический анализ" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Телефон">
          <Input name="phone" type="tel" defaultValue={values?.phone ?? ""} placeholder="+7 ..." />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={values?.email ?? ""} placeholder="ivanova@ranepa.ru" />
        </Field>
      </div>
      <Field label="Мессенджер" hint="Только то, что человек сам дал студентам.">
        <Input name="messenger" defaultValue={values?.messenger ?? ""} placeholder="ВК / Telegram @ник" />
      </Field>
      <Field label="Заметка">
        <Textarea name="note" defaultValue={values?.note ?? ""} placeholder="Приёмные часы: вт 14:00–16:00, каб. 305" className="min-h-16" />
      </Field>
      <SubmitButton className="w-full" size="lg">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
