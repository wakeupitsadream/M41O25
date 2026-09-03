"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

type Toast = { id: number; text: string; tone: "danger" | "ok" };
type Push = (text: string, tone?: Toast["tone"]) => void;

const ToastContext = createContext<Push>(() => {});

/** Короткое сообщение внизу экрана: оптимистичные тапы (голос, реакция, галочка) сообщают об ошибке, а не откатываются молча. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback<Push>((text, tone = "danger") => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4" style={{ bottom: "calc(var(--sab) + 5rem)" }}>
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              role="status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className={cn("max-w-xs rounded-full bg-surface-2 px-4 py-2 text-center text-[13px] font-medium shadow-float hairline", t.tone === "danger" ? "text-danger" : "text-fg")}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
