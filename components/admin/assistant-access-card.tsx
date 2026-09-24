import { extendAccess, setPaidUntil } from "@/app/admin/actions/assistant";
import { ConfirmButton } from "@/components/admin/forms";
import { AssistantPaidUntil } from "@/components/admin/assistant-paid-until";
import { Card } from "@/components/ui/card";
import { accessLine, fmtUntil } from "@/lib/assistant/admin-labels";
import type { AccessStatus } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<AccessStatus["kind"], string> = { none: "text-muted", trial: "text-fg", paid: "text-ok", expired: "text-warn" };

/**
 * Card «Помощник» в карточке человека (docs/AI-CHAT.md §2, §9). Серверный: состояние и будущая дата «до» считаются
 * на сервере по todayIso(), кнопки — клиентские ConfirmButton с привязанными server actions, как у соседней «Доступ».
 */
export function AssistantAccessCard({
  userId,
  fullName,
  status,
  paidUntil,
  nextPaidUntil,
  priceRub,
  enabled,
  today,
}: {
  userId: string;
  fullName: string;
  status: AccessStatus;
  /** paid_until из строки доступа, даже если уже прошла: её и подставляем в ручную дату. */
  paidUntil: string | null;
  /** Куда уедет срок после «+30 дней» (extendPaidUntil) — чтобы админ подтверждал конкретную дату, а не «что-то продлится». */
  nextPaidUntil: string;
  priceRub: number;
  enabled: boolean;
  today: string;
}) {
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-display text-[16px] font-bold">Помощник</div>
        <span className={cn("min-w-0 truncate text-[13px] font-medium", STATUS_TONE[status.kind])}>{accessLine(status, today)}</span>
      </div>
      {!enabled && <p className="text-[13px] text-dim">Помощник выключен в настройках: срок запишется, но чат человек увидит только после включения.</p>}
      <ConfirmButton
        variant="secondary"
        className="w-full"
        confirmText={`${fullName}: записать оплату ${priceRub} ₽ и продлить помощника до ${fmtUntil(nextPaidUntil, today)}?`}
        action={extendAccess.bind(null, userId, 30)}
      >
        +30 дней · {priceRub} ₽
      </ConfirmButton>
      <AssistantPaidUntil userId={userId} current={paidUntil} />
      {status.kind === "paid" && (
        <ConfirmButton
          variant="outline"
          className="w-full"
          confirmText={`${fullName}: снять оплату? Доступ по оплате закроется сразу, записанные платежи останутся в выручке.`}
          action={setPaidUntil.bind(null, userId, null)}
        >
          Снять оплату
        </ConfirmButton>
      )}
    </Card>
  );
}
