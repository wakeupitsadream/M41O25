import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { MonthSummary } from "@/lib/assistant/finance";
import { cn, pluralRu } from "@/lib/utils";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const TONE_TEXT = { ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;

const rub = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const kop = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Card «Помощник за месяц» на обзоре админа (docs/AI-CHAT.md §9): выручка по «+30 дней», расход по токенам,
 * маржа с цветом по порогам finance.ts. Расход с копейками — на старте он измеряется рублями, и «0 ₽» при
 * 40 копейках выглядел бы как «помощник ничего не стоит».
 */
export function AssistantMonthCard({ summary, monthStart, enabled }: { summary: MonthSummary; monthStart: string; enabled: boolean }) {
  const month = MONTHS[Number(monthStart.slice(5, 7)) - 1] ?? "";
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-muted">
          <Sparkles className="size-4" /> <span className="text-[12px] font-medium">Помощник за месяц</span>
        </div>
        <span className="text-[12px] text-dim">
          {month}
          {!enabled && " · выключен"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="выручка" value={`${rub(summary.revenueRub)} ₽`} />
        <Stat label="расход" value={`${kop(summary.costRub)} ₽`} />
        <Stat
          label={summary.marginPct === null ? "нет оплат" : "маржа"}
          value={summary.marginPct === null ? "—" : `${summary.marginPct} %`}
          // Без выручки цвет всё равно несёт смысл: warn — расход уже идёт (пробная неделя), а нули красить незачем.
          className={summary.marginPct !== null || summary.tone !== "ok" ? TONE_TEXT[summary.tone] : undefined}
        />
      </div>
      <div className="text-[12px] text-muted">
        {summary.messages} {pluralRu(summary.messages, "сообщение", "сообщения", "сообщений")} · {summary.activeUsers}{" "}
        {pluralRu(summary.activeUsers, "человек", "человека", "человек")} с помощником
      </div>
    </Card>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-2 px-3 py-2">
      <div className={cn("truncate font-display text-lg font-bold tnum", className)}>{value}</div>
      <div className="truncate text-[11px] text-dim">{label}</div>
    </div>
  );
}
