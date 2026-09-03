"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

/** Ошибка внутри админки: остаёмся в её оболочке, показываем повтор. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-surface p-6 text-center hairline">
      <TriangleAlert className="size-6 text-warn" />
      <div className="font-display text-lg font-bold">Не получилось</div>
      <p className="text-[14px] text-muted">Действие не выполнено. Повтори; если повторяется — проверь введённые данные.</p>
      <button type="button" onClick={reset} className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-accent-ink">
        <RotateCcw className="size-4" /> Повторить
      </button>
      {error.digest && <div className="text-[11px] text-dim tnum">код {error.digest}</div>}
    </div>
  );
}
