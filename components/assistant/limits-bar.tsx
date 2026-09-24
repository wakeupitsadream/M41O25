import { ddmm } from "@/lib/assistant/client/format";
import type { LimitsView } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

/**
 * «Сегодня 9 из 15 · Неделя 31 из 50 · Сильных 3 из 4» тонкими полосками (docs/AI-CHAT.md §8). Сброс по календарю
 * группы, а не скользящим окном — подпись так и говорит: в полночь и в понедельник.
 */
export function LimitsBar({ limits }: { limits: LimitsView }) {
  const rows = [
    { label: "Сегодня", v: limits.day },
    { label: "Неделя", v: limits.week },
    { label: "Сильных", v: limits.strong },
  ];
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
              <div
                className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-label={`${label}: ${v.used} из ${v.limit}`}
                aria-valuemin={0}
                aria-valuemax={v.limit}
                aria-valuenow={Math.min(v.used, v.limit)}
              >
                <div className={cn("h-full rounded-full", full ? "bg-warn" : "bg-fg/60")} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] leading-snug text-dim">Дневной лимит обновится в полночь, недельный — в понедельник {ddmm(limits.resetsWeek)}</p>
    </div>
  );
}
