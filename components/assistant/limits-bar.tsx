import { ddmm } from "@/lib/assistant/client/format";
import { BUDGET_HINT, BUDGET_LABEL, budgetMeter } from "@/lib/assistant/client/limits";
import type { LimitsView } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

function Bar({ label, pct, full, valueNow, valueMax, text }: { label: string; pct: number; full: boolean; valueNow: number; valueMax: number; text: string }) {
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={`${label}: ${text}`} aria-valuemin={0} aria-valuemax={valueMax} aria-valuenow={valueNow}>
      <div className={cn("h-full rounded-full", full ? "bg-warn" : "bg-fg/60")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * «Сегодня 9 из 15 · Неделя 31 из 50 · Сильных 3 из 4» тонкими полосками (docs/AI-CHAT.md §8). Сброс по календарю
 * группы, а не скользящим окном — подпись так и говорит: в полночь и в понедельник. Под ними — ресурс за 30 дней
 * в процентах: копейки себестоимости студенту ничего не скажут, а «потрачено 37 %» — скажет. Нет потолка
 * (цена 0) — нет и полоски.
 */
export function LimitsBar({ limits }: { limits: LimitsView }) {
  const rows = [
    { label: "Сегодня", v: limits.day },
    { label: "Неделя", v: limits.week },
    { label: "Сильных", v: limits.strong },
  ];
  const budget = limits.budget ? budgetMeter(limits.budget) : null;
  return (
    <div className="rounded-lg bg-surface p-4 hairline">
      <div className="grid grid-cols-3 gap-4">
        {rows.map(({ label, v }) => {
          const full = v.used >= v.limit;
          const pct = v.limit > 0 ? Math.min(100, Math.round((v.used / v.limit) * 100)) : 100;
          return (
            <div key={label} className="min-w-0">
              <div className="text-[12px] text-muted">{label}</div>
              <div className={cn("mt-0.5 text-[15px] font-semibold tnum", full && "text-warn")}>
                {v.used} <span className="font-normal text-muted">из {v.limit}</span>
              </div>
              <Bar label={label} pct={pct} full={full} valueNow={Math.min(v.used, v.limit)} valueMax={v.limit} text={`${v.used} из ${v.limit}`} />
            </div>
          );
        })}
      </div>
      {budget && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] text-muted">{BUDGET_LABEL}</span>
            <span className={cn("text-[15px] font-semibold tnum", budget.exhausted && "text-warn")}>{budget.text}</span>
          </div>
          <Bar label={BUDGET_LABEL} pct={budget.pct} full={budget.exhausted} valueNow={budget.pct} valueMax={100} text={budget.text} />
          <p className="mt-1.5 text-[12px] leading-snug text-dim">{BUDGET_HINT}</p>
        </div>
      )}
      <p className="mt-3 text-[12px] leading-snug text-dim">Дневной лимит обновится в полночь, недельный — в понедельник {ddmm(limits.resetsWeek)}</p>
    </div>
  );
}
