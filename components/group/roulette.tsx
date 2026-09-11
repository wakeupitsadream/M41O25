"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Dices, RotateCcw, UserMinus } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn, firstName } from "@/lib/utils";

type Person = { id: string; fullName: string; avatarEmoji: string; color: string };

/**
 * «Кто отвечает»: барабан крутит аватарки и замедляется на случайном человеке.
 * Режим «без повторов» убирает уже выбранных до конца сессии страницы; выключение режима
 * и кнопка сброса возвращают всех обратно.
 */
export function Roulette({ people }: { people: Person[] }) {
  const [pool, setPool] = useState(people);
  const [noRepeat, setNoRepeat] = useState(true);
  // Тумблер можно переключить прямо во время кручения — барабан читает актуальное значение, а не то, что было на старте.
  const noRepeatRef = useRef(noRepeat);
  // Храним самого человека, а не индекс: пул после победы уменьшается, и индекс начинал показывать соседа.
  const [shown, setShown] = useState<Person | null>(people[0] ?? null);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<Person | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => stop, []);

  const spin = () => {
    if (spinning || pool.length === 0) return;
    const round = pool;
    setWinner(null);
    setSpinning(true);
    const target = Math.floor(Math.random() * round.length);
    const totalSteps = round.length * 2 + 8 + Math.floor(Math.random() * round.length);
    let step = 0;
    let idx = Math.max(0, round.findIndex((p) => p.id === shown?.id));
    const tick = () => {
      idx = (idx + 1) % round.length;
      const person = round[idx];
      setShown(person);
      step++;
      const remaining = totalSteps - step;
      if (remaining <= 0 && idx === target) {
        stop();
        setSpinning(false);
        setWinner(person);
        try { navigator.vibrate?.([30, 40, 80]); } catch {}
        void import("canvas-confetti").then(({ default: confetti }) =>
          confetti({ particleCount: 60, spread: 70, origin: { y: 0.55 }, colors: ["#C8FF2E", "#F4F4F6", person.color] }),
        );
        if (noRepeatRef.current) setPool((p) => p.filter((x) => x.id !== person.id));
        return;
      }
      // Ускорение → плавное замедление к концу
      const delay = remaining > 12 ? 60 : 60 + (12 - Math.max(remaining, 0)) * 45;
      timer.current = setTimeout(tick, delay);
    };
    try { navigator.vibrate?.(10); } catch {}
    tick();
  };

  const reset = () => {
    stop();
    setSpinning(false);
    setPool(people);
    setWinner(null);
    setShown(people[0] ?? null);
  };

  // Выключили «без повторов» — возвращаем всех: иначе тумблер обещает повторы, а крутится урезанный список.
  const toggleNoRepeat = () => {
    const next = !noRepeat;
    noRepeatRef.current = next;
    setNoRepeat(next);
    if (!next) setPool(people);
  };

  const empty = pool.length === 0;

  return (
    <div className="space-y-6">
      <div className="relative mx-auto flex h-56 w-full max-w-xs items-center justify-center overflow-hidden rounded-xl bg-surface hairline">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_100%,rgba(200,255,46,0.14),transparent_70%)]" />
        <AnimatePresence mode="popLayout" initial={false}>
          {shown ? (
            <motion.div
              key={`${shown.id}-${winner ? "w" : "s"}`}
              initial={{ y: 40, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: winner ? 1.15 : 1 }}
              exit={{ y: -40, opacity: 0, scale: 0.8 }}
              transition={spinning ? { duration: 0.05 } : { type: "spring", stiffness: 300, damping: 18 }}
              className="flex flex-col items-center gap-3"
            >
              <Avatar user={shown} size="lg" className={cn("size-24 text-5xl", winner && "shadow-glow")} />
              <div className={cn("font-display text-2xl font-bold", winner ? "text-accent" : "text-fg")}>{firstName(shown.fullName)}</div>
            </motion.div>
          ) : (
            <div className="text-center text-muted">
              <div className="text-4xl">🏁</div>
              <div className="mt-2 text-[14px]">Некого крутить</div>
            </div>
          )}
        </AnimatePresence>
      </div>

      {winner && (
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center text-[15px] text-muted">
          Отвечает <span className="font-semibold text-fg">{winner.fullName}</span> 🎤
        </motion.p>
      )}

      <div className="flex gap-2">
        <Button size="lg" className="flex-1" disabled={spinning || empty} onClick={spin}>
          <Dices className="size-5" /> {empty ? "Все отвечали" : winner ? "Ещё раз" : "Крутить"}
        </Button>
        <Button size="lg" variant="secondary" aria-label="Сбросить" onClick={reset}>
          <RotateCcw className="size-5" />
        </Button>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={noRepeat}
        onClick={toggleNoRepeat}
        className={cn("flex min-h-11 w-full items-center gap-3 rounded-md px-3.5 py-2 text-left text-[14px] hairline", noRepeat ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")}
      >
        <UserMinus className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block">Без повторов</span>
          <span className="block text-[12px] text-muted">
            {noRepeat ? `осталось ${pool.length} из ${people.length}` : "повторы разрешены"}
          </span>
        </span>
        <Switch checked={noRepeat} />
      </button>
    </div>
  );
}
