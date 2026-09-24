"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Высота клавиатуры iPhone над нижним краем layout viewport, либо null, если её нет. iOS не сжимает layout viewport
 * под клавиатуру, поэтому fixed bottom:0 уходит под неё; меряем через visualViewport — та же формула, что у Sheet.
 * Порог 40 px отсекает полоску подсказок и дрожание при прокрутке.
 */
export function useKeyboardInset(): number | null {
  const [inset, setInset] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(offset > 40 ? Math.round(offset) : null);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/**
 * Нижняя панель экрана чата (композер или плашка «доступ закончился»): прижата к клавиатуре, когда она открыта,
 * и к safe-area, когда нет. Свою высоту сообщает наверх — лента резервирует под панель ровно столько места,
 * сколько та занимает (растёт вместе с textarea и чипами вложений).
 */
export function FixedBottom({ onHeight, children }: { onHeight: (h: number) => void; children: React.ReactNode }) {
  const inset = useKeyboardInset();
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onHeight);
  useEffect(() => {
    report.current = onHeight;
  }, [onHeight]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => report.current(Math.ceil(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-x-0 z-30 mx-auto w-full max-w-lg border-t border-border px-3 pt-2 glass"
      style={{ bottom: inset ?? 0, paddingBottom: inset ? "0.5rem" : "calc(var(--sab) + 0.5rem)" }}
    >
      {children}
    </div>
  );
}
