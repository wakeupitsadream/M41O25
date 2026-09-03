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
  const retried = useRef(false);

  const refresh = useCallback(async (isRetry = false) => {
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
      // SW может отдать кеш старее localStorage — берём более свежее по generatedAt.
      const local = readLocal();
      const best = local && new Date(local.generatedAt) > new Date(next.generatedAt) ? local : next;
      setData(best);
      writeLocal(best);
      // Service worker отдаёт кеш как обычный ответ: офлайн распознаём по navigator.onLine и возрасту данных.
      const ageMs = Date.now() - new Date(next.generatedAt).getTime();
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const stale = ageMs > 20 * 60_000;
      if (stale && !offline && !isRetry && !retried.current) {
        // Сеть есть, а данные старые: скорее всего SW отдал кеш, пока функция холодная. Пробуем ещё раз, потом уже «Офлайн».
        retried.current = true;
        setStatus("loading");
        setTimeout(() => void refresh(true), 4000);
        return;
      }
      if (!stale) retried.current = false;
      setStatus(offline || stale ? "offline" : "fresh");
    } catch {
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    const cached = readLocal();
    if (initial && (!cached || new Date(initial.generatedAt) >= new Date(cached.generatedAt))) {
      writeLocal(initial);
    } else if (cached) {
      setData(cached);
    }
    // Всегда дёргаем API при открытии: так service worker держит свежую копию для офлайна.
    void refresh();
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => void refresh(), 10 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [initial, refresh]);

  return { data, status, refresh };
}
