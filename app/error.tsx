"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

/** Границы ошибок: вместо «Application error» — понятный экран с повтором и входом. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const session = /Сессия не найдена/.test(error.message);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-warn">
        <TriangleAlert className="size-7" />
      </div>
      <h1 className="font-display text-2xl font-bold">{session ? "Нужно войти заново" : "Что-то пошло не так"}</h1>
      <p className="max-w-xs text-[15px] leading-relaxed text-muted">
        {session ? "Сессия на этом устройстве закончилась." : error.message && error.message.length < 140 ? error.message : "Попробуй ещё раз. Если повторяется — напиши админу."}
      </p>
      <div className="flex gap-2 pt-2">
        {session ? (
          <Link href="/enter" className="rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink active:bg-accent-press">
            Войти
          </Link>
        ) : (
          <button type="button" onClick={reset} className="flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink active:bg-accent-press">
            <RotateCcw className="size-4" /> Повторить
          </button>
        )}
        <Link href="/s" className="rounded-full bg-surface-2 px-6 py-3 font-semibold text-fg hairline">
          К расписанию
        </Link>
      </div>
    </main>
  );
}
