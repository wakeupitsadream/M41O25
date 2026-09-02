"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SchedulePayload } from "@/lib/schedule/types";

const LS_KEY = "raspison.schedule.v1";

const readLocal = (): SchedulePayload | null => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as SchedulePayload) : null;
  } catch {
    return null;
  }
};

const writeLocal = (p: SchedulePayload) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* переполнение или приватный режим — не критично */
  }
};

export type ScheduleStatus = "fresh" | "loading" | "offline" | "error";

/**
 * Данные расписания с тройной подстраховкой: серверный initialData → service worker (NetworkFirst) → localStorage.
 * Обновляется при возвращении на вкладку, появлении сети и раз в 10 минут.
 */
export function useSchedule(initial: SchedulePayload | null) {
  const [data, setData] = useState<SchedulePayload | null>(initial);
  const [status, setStatus] = useState<ScheduleStatus>(initial ? "fresh" : "loading");
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch("/api/schedule", { cache: "no-store", credentials: "same-origin" });
      if (res.status === 401) {
        window.location.href = "/enter";
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as SchedulePayload;
      setData(next);
      writeLocal(next);
      setStatus("fresh");
    } catch {
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    if (initial) {
      writeLocal(initial);
    } else {
      const cached = readLocal();
      if (cached) setData(cached);
      void refresh();
    }
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    const timer = setInterval(refresh, 10 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      clearInterval(timer);
    };
  }, [initial, refresh]);

  return { data, status, refresh };
}
