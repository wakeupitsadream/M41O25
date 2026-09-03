"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Share2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

/**
 * «Поделиться днём»: сервер рендерит PNG-карточку, Web Share отправляет её файлом в ВК/Telegram.
 * iOS разрешает navigator.share только сразу после тапа, поэтому PNG подгружаем заранее и в клике
 * вызываем share без ожиданий. Если поделиться не вышло — показываем картинку: долгое нажатие сохраняет её.
 */
export function ShareDayButton({ date }: { date: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const url = `/api/share/day?date=${date}`;

  useEffect(() => {
    blobRef.current = null;
    if (typeof navigator === "undefined" || !("share" in navigator)) return;
    let alive = true;
    // Небольшая задержка: при быстром листании дней не рендерим карточку на каждый.
    const timer = setTimeout(() => {
      fetch(url)
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => {
          if (alive) blobRef.current = b;
        })
        .catch(() => {});
    }, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url]);

  const showPreview = (blob: Blob, text: string) => {
    setPreview(URL.createObjectURL(blob));
    setHint(text);
  };

  const share = async () => {
    setState("busy");
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      let blob = blobRef.current;
      const ready = Boolean(blob);
      if (!blob) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        blob = await res.blob();
        blobRef.current = blob;
      }
      const file = new File([blob], `raspison-${date}.png`, { type: "image/png" });
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: "Расписание на день" });
          setState("done");
          setTimeout(() => setState("idle"), 1500);
          return;
        } catch (e) {
          if ((e as { name?: string }).name === "AbortError") {
            setState("idle");
            return;
          }
          // NotAllowedError после долгой загрузки — покажем картинку, её можно сохранить долгим нажатием.
          showPreview(blob, ready ? "Не удалось открыть меню «Поделиться». Нажми и удерживай картинку, чтобы сохранить." : "Картинка готова. Нажми и удерживай, чтобы сохранить или отправить.");
          setState("idle");
          return;
        }
      }
      showPreview(blob, "Нажми и удерживай картинку, чтобы сохранить или отправить.");
      setState("idle");
    } catch {
      setHint("Не удалось собрать карточку — попробуй ещё раз");
      setState("idle");
      setTimeout(() => setHint(null), 3000);
    }
  };

  const close = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setHint(null);
  };

  return (
    <>
      <button type="button" onClick={share} aria-label="Поделиться днём" disabled={state === "busy"} className="grid size-9 place-items-center rounded-full text-muted active:bg-surface-2">
        {state === "busy" ? <Loader2 className="size-5 animate-spin" /> : state === "done" ? <Check className="size-5 text-accent" /> : <Share2 className="size-5" />}
      </button>
      {hint && !preview && (
        <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ bottom: "calc(var(--sab) + 5rem)" }}>
          <div className="rounded-full bg-surface-2 px-4 py-2 text-[13px] font-medium text-danger shadow-float hairline">{hint}</div>
        </div>
      )}
      <AnimatePresence>
        {preview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/92 p-4" onClick={close} role="dialog" aria-modal="true">
            <button type="button" aria-label="Закрыть" onClick={close} className="absolute right-4 grid size-10 place-items-center rounded-full bg-white/10 text-white" style={{ top: "calc(var(--sat) + 0.75rem)" }}>
              <X className="size-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Карточка дня" className="max-h-[78dvh] w-auto max-w-full rounded-lg" style={{ WebkitTouchCallout: "default" } as React.CSSProperties} onClick={(e) => e.stopPropagation()} />
            {hint && <p className="max-w-xs text-center text-[13px] text-white/80">{hint}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
