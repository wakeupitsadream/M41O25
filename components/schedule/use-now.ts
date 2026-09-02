"use client";

import { useEffect, useState } from "react";
import { nowParts, type NowParts } from "@/lib/schedule/time";

/**
 * Текущее время в поясе группы. До монтирования — null (чтобы серверный и клиентский рендер совпали),
 * затем обновляется каждые N секунд и при возврате на вкладку.
 */
export function useNow(intervalMs = 30_000): NowParts | null {
  const [now, setNow] = useState<NowParts | null>(null);
  useEffect(() => {
    const tick = () => setNow(nowParts());
    tick();
    const t = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);
  return now;
}
