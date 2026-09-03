"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Нижний лист: тянется вниз для закрытия, учитывает safe-area. Скролл фона блокируется «классическим» способом
 * (body position:fixed), потому что iOS Safari игнорирует overflow:hidden на body.
 */
export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  const controls = useDragControls();
  const savedScroll = useRef(0);

  useEffect(() => {
    if (!open) return;
    savedScroll.current = window.scrollY;
    const body = document.body;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    body.style.position = "fixed";
    body.style.top = `-${savedScroll.current}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo({ top: savedScroll.current, behavior: "instant" as ScrollBehavior });
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            className="fixed inset-0 z-40 touch-none bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            onTouchMove={(e) => e.preventDefault()}
          />
          <motion.div
            key="panel"
            role="dialog"
            aria-modal
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg rounded-t-xl bg-surface shadow-float hairline",
              "max-h-[92dvh] overflow-y-auto overscroll-contain scrollbar-none",
              className,
            )}
            style={{ paddingBottom: "calc(var(--sab) + 1rem)", WebkitOverflowScrolling: "touch" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) onClose();
            }}
          >
            <div
              className="sticky top-0 z-10 flex cursor-grab touch-none flex-col items-center rounded-t-xl bg-surface pt-2.5"
              onPointerDown={(e) => controls.start(e)}
            >
              <div className="h-1.5 w-10 rounded-full bg-border-strong" />
              <div className="flex w-full items-center justify-between px-5 pb-2 pt-3">
                <h2 className="font-display text-lg font-bold">{title}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Закрыть"
                  className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted active:scale-95"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="px-5 pb-2">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
