"use client";

import { useEffect, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Подсказка «добавь на экран Домой»: показывается только в браузере на телефоне (не в установленной PWA),
 * один раз — до закрытия. В Safari нет beforeinstallprompt, поэтому объясняем руками.
 */
export function InstallHint() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    try {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      const dismissed = localStorage.getItem("raspison.install.dismissed") === "1";
      const mobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
      setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
      setShow(!standalone && !dismissed && mobile);
    } catch {
      setShow(false);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem("raspison.install.dismissed", "1");
    } catch {}
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="relative rounded-lg bg-accent/10 p-4 ring-1 ring-accent/30">
          <button type="button" aria-label="Скрыть" onClick={dismiss} className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-surface-2 text-muted">
            <X className="size-3.5" />
          </button>
          <div className="font-display text-[15px] font-bold">Поставь как приложение</div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Иконка на экране, открывается за секунду, расписание работает без интернета.
          </p>
          <ol className="mt-3 space-y-1.5 text-[13px]">
            <li className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-accent">
                <Share className="size-3.5" />
              </span>
              {ios ? "Нажми «Поделиться» внизу Safari" : "Открой меню браузера (⋮)"}
            </li>
            <li className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-accent">
                <SquarePlus className="size-3.5" />
              </span>
              {ios ? "Выбери «На экран „Домой“»" : "Выбери «Добавить на главный экран»"}
            </li>
          </ol>
          <p className="mt-2 text-[11px] text-dim">После установки войди ещё раз — у приложения на iPhone своя память.</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
