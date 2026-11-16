import { eq } from "drizzle-orm";
import { ActionForm } from "@/components/ui/action-form";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { groups } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { applyDefaultSlotTimes, rotateInviteCode, updateGroupName, updateSlotTimes } from "@/app/admin/actions/catalog";
import { DEFAULT_SLOT_TIMES, MAX_SLOTS } from "@/lib/schedule/slots";
import { Card } from "@/components/ui/card";
import { Field, Input, TimeInput } from "@/components/ui/input";
import { ConfirmButton, SubmitButton } from "@/components/admin/forms";
import { AssistantSettingsForm } from "@/components/admin/assistant-settings-form";
import { env } from "@/lib/env";
import { withDefaults } from "@/lib/assistant/settings";

export default async function AdminSettings() {
  const admin = await requireRole("admin");
  const [group] = await db.select().from(groups).where(eq(groups.id, admin.groupId));
  const slots = Array.from({ length: MAX_SLOTS }, (_, i) => group.slotTimes.find((s) => s.slot === i + 1) ?? { slot: i + 1, start: "", end: "" });
  const standard =
    group.slotTimes.length === DEFAULT_SLOT_TIMES.length &&
    DEFAULT_SLOT_TIMES.every((d) => group.slotTimes.some((s) => s.slot === d.slot && s.start === d.start && s.end === d.end));
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "raspison.vercel.app"}`;
  const inviteLink = `${origin}/enter?code=${encodeURIComponent(group.inviteCode)}`;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-bold leading-none">Настройки</h1>

      <Card className="space-y-3">
        <div className="font-display text-[16px] font-bold">Инвайт-код</div>
        <div className="rounded-md bg-surface-2 px-4 py-3 text-center font-display text-2xl font-bold tracking-[0.2em]">{group.inviteCode}</div>
        <p className="text-[13px] text-muted">Кинь его в беседу группы. Смена кода не разлогинит тех, кто уже вошёл — код нужен только для входа.</p>
        <div className="rounded-md bg-surface-2 px-3 py-2 text-[12px] text-muted">
          <div className="mb-0.5 font-medium text-fg">Ссылка для беседы (код подставится сам)</div>
          <div className="select-all break-all font-mono text-[12px]">{inviteLink}</div>
        </div>
        <ConfirmButton variant="secondary" className="w-full" confirmText="Сменить код? Старый перестанет работать сразу." action={rotateInviteCode}>
          Сменить код
        </ConfirmButton>
      </Card>

      <Card>
        <ActionForm action={updateGroupName} className="space-y-3">
          <div className="font-display text-[16px] font-bold">Группа</div>
          <Field label="Шифр группы" hint="Короткий: с него начинается инвайт-код.">
            <Input name="shortName" defaultValue={group.shortName} placeholder="М41О25" required />
          </Field>
          <Field label="Как подписывать в приложении" hint="Видно в шапке и на экране входа.">
            <Input name="name" defaultValue={group.name} placeholder={`Группа ${group.shortName}`} />
          </Field>
          <SubmitButton className="w-full" variant="secondary">
            Сохранить
          </SubmitButton>
        </ActionForm>
      </Card>

      <Card className="space-y-3">
        <ActionForm action={updateSlotTimes} className="space-y-3">
          <div className="font-display text-[16px] font-bold">Время пар</div>
          <p className="text-[13px] text-muted">
            Подставляется при добавлении пары, в черновик по скану и в «Звонки» у всех. С осени 2026 в сетке филиала шесть пар по 80 минут — серым
            показано стандартное время. 24 часа, можно набрать «830» — станет «08:30». Пустые строки не учитываются.
          </p>
          <div className="space-y-2">
            <div className="grid grid-cols-[1.75rem_1fr_1fr] items-center gap-2 text-[13px] font-medium text-muted">
              <span />
              <span>Начало</span>
              <span>Конец</span>
            </div>
            {/* key со временем: после «Поставить стандартную сетку» страница приходит с новыми значениями, а поле
                времени держит набранное в своём состоянии — без перемонтирования строка показала бы старое. Ключ
                именно на строке, а не на форме: форма хранит «Время пар сохранено» после обычного сохранения. */}
            {slots.map((s) => (
              <div key={`${s.slot}:${s.start}-${s.end}`} className="grid grid-cols-[1.75rem_1fr_1fr] items-center gap-2">
                <span className="text-center font-semibold tnum">{s.slot}</span>
                <TimeInput name={`start${s.slot}`} defaultValue={s.start} placeholder={DEFAULT_SLOT_TIMES[s.slot - 1]?.start} aria-label={`Начало ${s.slot}-й пары`} className="px-3" />
                <TimeInput name={`end${s.slot}`} defaultValue={s.end} placeholder={DEFAULT_SLOT_TIMES[s.slot - 1]?.end} aria-label={`Конец ${s.slot}-й пары`} className="px-3" />
              </div>
            ))}
          </div>
          <SubmitButton className="w-full" variant="secondary">
            Сохранить
          </SubmitButton>
        </ActionForm>
        <ConfirmButton
          variant="secondary"
          className="w-full"
          disabled={standard}
          confirmText="Заменить время пар на стандартную сетку филиала: шесть пар, 08:30–17:50?"
          action={applyDefaultSlotTimes}
        >
          {standard ? "Стоит стандартная сетка: 6 пар" : "Поставить стандартную сетку: 6 пар"}
        </ConfirmButton>
      </Card>

      <Card>
        <AssistantSettingsForm
          values={withDefaults(group.assistantSettings)}
          configured={env.assistant.configured}
          models={{ model: env.assistant.model, strongModel: env.assistant.strongModel }}
          rate={env.assistant.usdRub}
          markup={env.assistant.polzaMarkup}
        />
      </Card>
    </div>
  );
}
