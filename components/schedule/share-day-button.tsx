"use client";

import { useState } from "react";
import { Check, Loader2, Share2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

/**
 * «Поделиться днём»: сервер рендерит PNG-карточку (app/api/share/day), Web Share отправляет её файлом в ВК/Telegram.
 * Картинка собирается только по тапу. Раньше она грузилась заранее при каждом открытии дня, то есть каждый просмотр
 * расписания стоил серверу рендера satori ради кнопки, которой пользуются редко (ревью PERF-06). iOS разрешает
 * navigator.share только сразу после тапа, поэтому после загрузки показываем превью с кнопкой «Поделиться» — тап по
 * ней даёт свежую user activation. Долгое нажатие на картинку сохраняет её: запасной путь, если меню не открылось.
 */
type Preview = { url: string; file: File; canShare: boolean };

export function ShareDayButton({ date }: { date: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const url = `/api/share/day?date=${date}`;

  const nav = () => navigator as Navigator & { canShare?: (d: ShareData) => boolean };

  const open = async () => {
    setState("busy");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], `raspison-${date}.png`, { type: "image/png" });
      const n = nav();
      setPreview({ url: URL.createObjectURL(blob), file, canShare: typeof n.share === "function" && Boolean(n.canShare?.({ files: [file] })) });
      setHint(null);
      setState("idle");
    } catch {
      setHint("Не удалось собрать карточку — попробуй ещё раз");
      setState("idle");
      setTimeout(() => setHint(null), 3000);
    }
  };

  const close = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setHint(null);
  };

  const share = async () => {
    if (!preview) return;
    try {
      await nav().share({ files: [preview.file], title: "Расписание на день" });
      close();
      setState("done");
      setTimeout(() => setState("idle"), 1500);
    } catch (e) {
      // AbortError — человек сам закрыл меню, превью остаётся; остальное — меню не открылось, остаётся долгое нажатие.
      if ((e as { name?: string }).name === "AbortError") return;
      setHint("Не удалось открыть меню «Поделиться». Нажми и удерживай картинку, чтобы сохранить.");
    }
  };

  return (
    <>
      <button type="button" onClick={open} aria-label="Поделиться днём" disabled={state === "busy"} className="grid size-10 place-items-center rounded-full text-muted active:bg-surface-2">
        {state === "busy" ? <Loader2 className="size-5 animate-spin" /> : state === "done" ? <Check className="size-5 text-accent" /> : <Share2 className="size-5" />}
      </button>
      {hint && !preview && (
        <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ bottom: "calc(var(--sab) + 5rem)" }}>
          <div className="rounded-full bg-surface-2 px-4 py-2 text-[13px] font-medium text-danger shadow-float hairline">{hint}</div>
        </div>
      )}
      <AnimatePresence>
        {preview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/92 p-4" onClick={close} role="dialog" aria-modal="true">
            <button type="button" aria-label="Закрыть" onClick={close} className="absolute right-4 grid size-10 place-items-center rounded-full bg-white/10 text-white" style={{ top: "calc(var(--sat) + 0.75rem)" }}>
              <X className="size-5" />
            </button>
            <img src={preview.url} alt="Карточка дня" className="max-h-[68dvh] w-auto max-w-full rounded-lg" style={{ WebkitTouchCallout: "default" } as React.CSSProperties} onClick={(e) => e.stopPropagation()} />
            {preview.canShare && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void share();
                }}
                className="flex h-12 items-center gap-2 rounded-full bg-accent px-6 font-semibold text-accent-ink active:bg-accent-press"
              >
                <Share2 className="size-4" /> Поделиться
              </button>
            )}
            <p className="max-w-xs text-center text-[13px] text-white/80">
              {hint ?? (preview.canShare ? "Или нажми и удерживай картинку, чтобы сохранить." : "Нажми и удерживай картинку, чтобы сохранить или отправить.")}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
