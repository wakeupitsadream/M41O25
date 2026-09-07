"use client";

import { useEffect, useRef, useState } from "react";
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
/**
 * Замок скролла на весь документ со счётчиком: шторка поверх шторки не должна ни повторно запоминать уже
 * заблокированное состояние body, ни снимать замок, пока открыта хоть одна. Восстанавливаем стили и позицию
 * только когда закрылась последняя.
 */
let locks = 0;
let lockState: { position: string; top: string; width: string; overflow: string; scrollY: number } | null = null;

function lockScroll(): () => void {
  const body = document.body;
  if (locks === 0) {
    lockState = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow, scrollY: window.scrollY };
    body.style.position = "fixed";
    body.style.top = `-${lockState.scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
  }
  locks++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks--;
    if (locks > 0 || !lockState) return;
    body.style.position = lockState.position;
    body.style.top = lockState.top;
    body.style.width = lockState.width;
    body.style.overflow = lockState.overflow;
    window.scrollTo({ top: lockState.scrollY, behavior: "instant" as ScrollBehavior });
    lockState = null;
  };
}

export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  const controls = useDragControls();
  // Escape закрывает актуальным обработчиком, но не переинициализирует замок скролла.
  const closeRef = useRef(onClose);
  // Клавиатура iOS не меняет layout viewport: следим за visualViewport и поднимаем лист над клавиатурой.
  const [kb, setKb] = useState<{ height: number; offset: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKb(offset > 40 ? { height: vv.height, offset } : null);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocus);
      setKb(null);
    };
  }, [open]);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const release = lockScroll();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      release();
      window.removeEventListener("keydown", onKey);
    };
    // onClose намеренно вне зависимостей: у шторок он часто инлайновая стрелка, и переинициализация замка
    // на каждый ре-рендер ломала бы восстановление скролла (особенно у шторки поверх шторки).
  }, [open]);

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
            style={{
              paddingBottom: kb ? "1rem" : "calc(var(--sab) + 1rem)",
              WebkitOverflowScrolling: "touch",
              bottom: kb ? kb.offset : 0,
              maxHeight: kb ? Math.round(kb.height * 0.96) : undefined,
            }}
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
