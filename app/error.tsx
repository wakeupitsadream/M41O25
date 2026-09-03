"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RotateCcw, TriangleAlert, WifiOff } from "lucide-react";

/**
 * Граница ошибок вместо «Application error». В production Next скрывает текст серверных ошибок,
 * поэтому по тексту ничего не угадываем; отдельно распознаём только отсутствие сети.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    console.error(error);
    setOffline(typeof navigator !== "undefined" && (!navigator.onLine || /Failed to fetch|Load failed|NetworkError|fetch failed/i.test(error.message)));
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-warn">{offline ? <WifiOff className="size-7" /> : <TriangleAlert className="size-7" />}</div>
      <h1 className="font-display text-2xl font-bold">{offline ? "Нет сети" : "Что-то пошло не так"}</h1>
      <p className="max-w-xs text-[15px] leading-relaxed text-muted">
        {offline ? "Действие не отправлено. Появится связь — повтори." : "Попробуй ещё раз. Если повторяется — напиши админу."}
      </p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <button type="button" onClick={reset} className="flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink active:bg-accent-press">
          <RotateCcw className="size-4" /> Повторить
        </button>
        <Link href="/s" className="rounded-full bg-surface-2 px-6 py-3 font-semibold text-fg hairline">
          К расписанию
        </Link>
      </div>
      <Link href="/api/auth/clear" className="pt-2 text-[13px] text-dim underline-offset-4 hover:underline">
        Войти заново
      </Link>
      {error.digest && <div className="text-[11px] text-dim tnum">код {error.digest}</div>}
    </main>
  );
}
