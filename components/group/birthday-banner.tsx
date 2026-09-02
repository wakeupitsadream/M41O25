"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

type Person = { id: string; fullName: string; firstName: string };

/**
 * День рождения: именинник получает конфетти на весь экран (один раз в день на устройстве),
 * остальные — баннер над контентом. Данные уже есть в профилях, бэкенд не нужен.
 */
export function BirthdayBanner({ today, people, meId }: { today: string; people: Person[]; meId: string }) {
  const [hidden, setHidden] = useState(true);
  const key = `raspison.bday.${today}`;
  const isMine = people.some((p) => p.id === meId);

  useEffect(() => {
    if (people.length === 0) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(key) === "1";
    } catch {}
    setHidden(dismissed);
    if (isMine && !dismissed) {
      void import("canvas-confetti").then(({ default: confetti }) => {
        const end = Date.now() + 1800;
        const frame = () => {
          confetti({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors: ["#C8FF2E", "#F4F4F6", "#8FA6FF", "#FF8FC8"] });
          confetti({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors: ["#C8FF2E", "#F4F4F6", "#8FA6FF", "#FF8FC8"] });
          if (Date.now() < end) requestAnimationFrame(frame);
        };
        frame();
      });
    }
  }, [key, isMine, people.length]);

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(key, "1");
    } catch {}
  };

  if (people.length === 0) return null;
  const names = people.map((p) => p.firstName).join(" и ");

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          className="fixed inset-x-0 z-30 mx-auto flex w-full max-w-lg justify-center px-4"
          style={{ top: "calc(var(--sat) + 0.5rem)" }}
        >
          <div className="flex w-full items-center gap-3 rounded-full bg-accent py-2 pl-4 pr-2 text-accent-ink shadow-glow">
            <span className="text-xl">🎉</span>
            <Link href="/group/birthdays" className="flex-1 text-[14px] font-semibold leading-tight" onClick={dismiss}>
              {isMine ? "С днём рождения! Группа поздравляет 🎂" : `Сегодня ДР у ${names} — поздравь!`}
            </Link>
            <button type="button" aria-label="Скрыть" onClick={dismiss} className="grid size-8 place-items-center rounded-full bg-accent-ink/10">
              <X className="size-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
