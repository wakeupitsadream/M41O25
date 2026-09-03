"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

export type GridImage = { id: string; url: string; name: string };

/**
 * Сетка фото с просмотром внутри приложения. Установленная на iPhone PWA открывает внешние ссылки
 * в отдельном браузере без нашей cookie, поэтому фото не уводим наружу, а показываем поверх экрана.
 */
export function ImageGrid({ images, className, rounded = "rounded-lg", singleMax = "max-h-96" }: { images: GridImage[]; className?: string; rounded?: string; singleMax?: string }) {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (images.length === 0) return null;
  const current = open !== null ? images[open] : null;

  return (
    <>
      <div className={cn("grid gap-2", images.length === 1 ? "grid-cols-1" : "grid-cols-2", className)}>
        {images.map((a, i) => (
          <button key={a.id} type="button" onClick={() => setOpen(i)} aria-label={`Открыть фото ${a.name}`} className={cn("block overflow-hidden hairline", rounded)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.name} className={cn("w-full object-cover", images.length === 1 ? singleMax : "aspect-square")} loading="lazy" />
          </button>
        ))}
      </div>
      <AnimatePresence>
        {current && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label={current.name}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/92"
            onClick={() => setOpen(null)}
          >
            <button
              type="button"
              aria-label="Закрыть"
              onClick={() => setOpen(null)}
              className="absolute right-4 z-10 grid size-10 place-items-center rounded-full bg-white/10 text-white active:bg-white/20"
              style={{ top: "calc(var(--sat) + 0.75rem)" }}
            >
              <X className="size-5" />
            </button>
            <div className="max-h-full w-full overflow-auto p-2" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.url}
                alt={current.name}
                className="mx-auto max-h-[92dvh] w-auto max-w-full select-none"
                style={{ WebkitTouchCallout: "default" } as CSSProperties}
              />
            </div>
            {images.length > 1 && open !== null && (
              <div className="pointer-events-none absolute bottom-8 rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/80 tnum">
                {open + 1} / {images.length}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
