"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RotateCcw, TriangleAlert, WifiOff } from "lucide-react";
import { classifyError, type ErrorKind } from "@/lib/ops/error-kind";

/**
 * Ошибка внутри оболочки приложения: это error.tsx сегмента (app), лэйаут с таб-баром и колонкой плашек стоит выше
 * и остаётся на месте — человек не теряет навигацию в установленной PWA. Без этой границы любое непойманное
 * исключение (например, server action без сети) уводило на корневой app/error.tsx: пустой экран без таб-бара,
 * потерянный скролл и набранный текст (ревью UI-01). Про связь не гадаем: «Нет сети» — только когда браузер
 * прямо говорит, что сети нет (lib/ops/error-kind.ts).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [kind, setKind] = useState<ErrorKind>("unknown");

  useEffect(() => {
    console.error(error);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator доступен только после монтирования; на сервере окно неизвестно.
    setKind(classifyError({ online: typeof navigator === "undefined" ? undefined : navigator.onLine, message: error.message }));
  }, [error]);

  const offline = kind === "offline";
  const Icon = offline ? WifiOff : TriangleAlert;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pt-24 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-warn">
        <Icon className="size-7" />
      </div>
      <h1 className="font-display text-2xl font-bold">{offline ? "Нет сети" : "Не получилось"}</h1>
      <p className="max-w-xs text-[15px] leading-relaxed text-muted">
        {offline ? "Экран не загрузился без связи. Появится сеть — повтори." : "Экран не загрузился. Повтори; если повторяется — назови админу код ошибки."}
      </p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <button type="button" onClick={reset} className="flex min-h-11 items-center gap-2 rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink active:bg-accent-press">
          <RotateCcw className="size-4" /> Повторить
        </button>
        <Link href="/s" className="flex min-h-11 items-center rounded-full bg-surface-2 px-6 py-3 font-semibold text-fg hairline">
          К расписанию
        </Link>
      </div>
      {error.digest && <div className="text-[11px] text-dim tnum">код {error.digest} — назови его админу</div>}
    </div>
  );
}
