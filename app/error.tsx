"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck, CircleAlert, RotateCcw, ServerCrash, Stethoscope, TriangleAlert, WifiOff } from "lucide-react";
import { classifyError, errorCopy, probeVerdict, type ErrorKind, type ProbeVerdict } from "@/lib/ops/error-kind";

const ICONS = { offline: WifiOff, "server-error": ServerCrash, unknown: TriangleAlert } as const;
const TONE = { ok: "text-ok", warn: "text-warn", bad: "text-danger" } as const;

/**
 * Граница ошибок вместо «Application error». В production Next скрывает текст серверных ошибок, поэтому
 * по тексту ничего не угадываем: «Нет сети» показываем, только когда браузер сам сказал, что сети нет
 * (иначе поломка сервера читается как проблема со связью и человек чинит не то — см. lib/ops/error-kind.ts).
 * Кнопка «Проверить связь» отвечает на этот вопрос за секунду и работает в установленной PWA.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [kind, setKind] = useState<ErrorKind>("unknown");
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<ProbeVerdict | null>(null);

  useEffect(() => {
    console.error(error);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator доступен только после монтирования; на сервере окно неизвестно.
    setKind(classifyError({ online: typeof navigator === "undefined" ? undefined : navigator.onLine, message: error.message }));
  }, [error]);

  const copy = errorCopy(kind);
  const Icon = ICONS[kind];

  const check = async () => {
    setChecking(true);
    setVerdict(null);
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 8000);
    try {
      // Уникальный параметр — чтобы ответ не пришёл из HTTP-кеша iOS: проверка должна доходить до сервера.
      const res = await fetch(`/api/health?t=${Date.now()}`, { cache: "no-store", signal: stop.signal, headers: { accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as { env?: string | null; branch?: string | null } | null;
      setVerdict(probeVerdict({ reached: true, status: res.status, env: body?.env ?? null, branch: body?.branch ?? null }));
    } catch {
      setVerdict(probeVerdict({ reached: false }));
    } finally {
      clearTimeout(timer);
      setChecking(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-warn">
        <Icon className="size-7" />
      </div>
      <h1 className="font-display text-2xl font-bold">{copy.title}</h1>
      <p className="max-w-xs text-[15px] leading-relaxed text-muted">{copy.hint}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <button type="button" onClick={reset} className="flex min-h-11 items-center gap-2 rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink active:bg-accent-press">
          <RotateCcw className="size-4" /> Повторить
        </button>
        <Link href="/s" className="flex min-h-11 items-center rounded-full bg-surface-2 px-6 py-3 font-semibold text-fg hairline">
          К расписанию
        </Link>
      </div>
      <div className="flex w-full max-w-xs flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="flex min-h-11 items-center gap-2 rounded-full bg-surface-2 px-5 py-2.5 text-[14px] font-semibold text-fg hairline disabled:text-muted"
        >
          <Stethoscope className="size-4" /> {checking ? "Проверяю…" : "Проверить связь"}
        </button>
        {verdict && (
          <p className={`flex max-w-xs items-start gap-2 text-left text-[13px] leading-relaxed ${TONE[verdict.tone]}`} role="status">
            {verdict.tone === "ok" ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
            <span>{verdict.text}</span>
          </p>
        )}
      </div>
      <Link href="/api/auth/clear" className="pt-2 text-[13px] text-dim underline-offset-4 hover:underline">
        Войти заново
      </Link>
      {error.digest && <div className="text-[11px] text-dim tnum">код {error.digest} — назови его админу</div>}
    </main>
  );
}
