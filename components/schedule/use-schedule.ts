"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SchedulePayload } from "@/lib/schedule/types";

const LS_KEY = "raspison.schedule.v1";
/** Имя кеша как у NetworkFirst для /api/schedule в app/sw.ts: туда же кладём серверный payload, минуя сеть. */
const SW_CACHE = "raspison-schedule";
/** Серверный payload моложе этого — за тем же самым в /api/schedule не ходим. */
const FRESH_MS = 2 * 60_000;

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

/**
 * Офлайн-копия для service worker без запроса: Cache API доступен и из окна. Ключ — тот же URL, который запрашивает
 * refresh(), заголовок date нужен ExpirationPlugin, чтобы считать возраст записи. Без заголовка x-raspison-cache:
 * его ставит сам SW на копии, которую отдаёт странице (app/sw.ts).
 */
const writeSwCache = async (p: SchedulePayload) => {
  try {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(SW_CACHE);
    await cache.put("/api/schedule", new Response(JSON.stringify(p), { headers: { "content-type": "application/json", date: new Date().toUTCString() } }));
  } catch {
    /* приватный режим или небезопасный контекст — остаётся localStorage */
  }
};

const ageMs = (p: SchedulePayload) => Date.now() - new Date(p.generatedAt).getTime();

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
  // Повтор через 4 с вызывает refresh из его же тела: держим ссылку в ref, иначе обращение к переменной до объявления.
  const refreshRef = useRef<((isRetry?: boolean) => Promise<void>) | null>(null);
  // Серверный payload для монтирующего эффекта: он нужен там один раз, а зависимость от initial заставляла эффект
  // (и запрос к /api/schedule) повторяться после каждой RSC-перерисовки страницы (ревью PERF-03).
  const initialRef = useRef(initial);

  const refresh = useCallback(async (isRetry = false) => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch("/api/schedule", { cache: "no-store", credentials: "same-origin" });
      if (res.status === 401) {
        // Сессия умерла: нужна полная перезагрузка с сервера, а не клиентский переход.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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
      // Service worker отдаёт кеш как обычный ответ, но помечает его заголовком (app/sw.ts). navigator.onLine
      // врёт на wifi без интернета и в headless-браузерах, поэтому смотрим на заголовок, сеть и возраст данных.
      const fromCache = res.headers.get("x-raspison-cache") === "1";
      const netDown = typeof navigator !== "undefined" && !navigator.onLine;
      const stale = ageMs(next) > 20 * 60_000;
      if ((fromCache || stale) && !netDown && !isRetry && !retried.current) {
        // Сеть вроде есть, а ответ из кеша: скорее всего функция холодная или связь моргнула. Пробуем ещё раз, потом уже «Офлайн».
        retried.current = true;
        setStatus("loading");
        setTimeout(() => void refreshRef.current?.(true), 4000);
        return;
      }
      if (!fromCache && !stale) retried.current = false;
      setStatus(fromCache || netDown || stale ? "offline" : "fresh");
    } catch {
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);

  // Новый payload с сервера — при первом рендере и после RSC-перерисовки страницы (router.refresh из плашки очереди ДЗ,
  // revalidate после server action): если он не старее localStorage, показываем его и кладём в обе офлайн-копии.
  // В сеть за тем же самым не ходим: раньше каждое открытие расписания повторяло запрос к /api/schedule.
  useEffect(() => {
    if (!initial) return;
    const cached = readLocal();
    if (cached && new Date(cached.generatedAt) > new Date(initial.generatedAt)) return;
    writeLocal(initial);
    void writeSwCache(initial);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial меняется снаружи после RSC-перерисовки; при первом рендере state уже равен initial, и это no-op.
    setData(initial);
  }, [initial]);

  useEffect(() => {
    const init = initialRef.current;
    const cached = readLocal();
    if (cached && (!init || new Date(cached.generatedAt) > new Date(init.generatedAt))) {
      // Страница приехала из кеша service worker со старым initial, а localStorage хранит более свежую копию.
      setData(cached);
    }
    // Свежий серверный payload в сеть не гоняем: /api/schedule вернул бы то же самое, а офлайн-копии уже обновил
    // эффект выше. Старый (страница из bfcache или кеша SW) обновляем сразу, как и раньше. Без сети страница
    // целиком могла приехать из кеша SW со свежим на вид initial — тогда всё равно идём в refresh(): он получит
    // копию из кеша и честно покажет «Офлайн» (e2e/offline.mjs).
    const netDown = typeof navigator !== "undefined" && !navigator.onLine;
    if (!init || netDown || ageMs(init) >= FRESH_MS) void refresh();
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    // Сеть пропала при открытом экране: плашку показываем сразу, не дожидаясь следующего запроса.
    const onOffline = () => setStatus((s) => (s === "fresh" ? "offline" : s));
    window.addEventListener("offline", onOffline);
    const timer = setInterval(() => void refresh(), 10 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(timer);
    };
  }, [refresh]);

  return { data, status, refresh };
}
