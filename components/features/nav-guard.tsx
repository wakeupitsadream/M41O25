"use client";

import { useEffect, useLayoutEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

/**
 * Сторож переходов — обход ошибки React 19.1 внутри Next 15.5 (docs/ROADMAP.md, «Открытая проблема P0»):
 * клиентский переход, server action или router.refresh() иногда не коммитятся, хотя ответ сервера уже пришёл
 * целиком. Признак зависания: ответ на fetch страницы получен, а спустя SETTLE_MS ни URL, ни дерево не
 * изменились. Тогда уходим обычной навигацией браузера (для refresh и форм — перезагружаем страницу):
 * это всегда работает, а данные действия к тому моменту уже сохранены на сервере.
 */

const SETTLE_MS = 2500; // сколько ждём коммита после прихода ответа; в норме он занимает меньше 300 мс
const GIVE_UP_MS = 30_000; // дольше не следим: сервер ещё отвечает либо пользователь уже ушёл сам
const TICK_MS = 250;

/** Момент последнего применения нового RSC-дерева: NavWatchdog в лэйауте перерисовывается вместе с ним. */
let lastCommitAt = 0;
let active: (() => void) | null = null;

/** Когда (performance.now) пришёл последний fetch-ответ на этот путь после performance.clearResourceTimings, либо null. */
function arrivedAt(pathname: string, rscOnly: boolean): number | null {
  let latest: number | null = null;
  for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (e.initiatorType !== "fetch" || !e.responseEnd) continue;
    if (rscOnly && !e.name.includes("_rsc=")) continue;
    let p: string;
    try {
      p = new URL(e.name).pathname;
    } catch {
      continue;
    }
    if (p !== pathname) continue;
    if (latest === null || e.responseEnd > latest) latest = e.responseEnd;
  }
  return latest;
}

let lastAction: { at: number; redirect: string | null } | null = null;
let fetchWrapped = false;

/** Запоминаем ответы server actions: когда пришёл и куда велел перейти (заголовок x-action-redirect). */
function wrapFetch() {
  if (fetchWrapped) return;
  fetchWrapped = true;
  const orig = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const res = await orig.call(this, input, init);
    try {
      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (h.has("Next-Action")) {
        const raw = res.headers.get("x-action-redirect");
        lastAction = { at: performance.now(), redirect: raw ? raw.split(";")[0] || null : null };
      }
    } catch {
      // нестандартные заголовки — не наш запрос
    }
    return res;
  };
}

/**
 * arrivedAt — когда пришёл ответ, которого ждёт переход; settled — признак успеха. Коммит дерева считается
 * успехом только если он случился ПОСЛЕ прихода ответа: коммит от самого server action не должен
 * засчитываться за коммит следующего за ним refresh.
 */
type Guard = { arrivedAt: () => number | null; settled: (arrived: number | null) => boolean; recover: () => void; label: string };

const committedAfter = (arrived: number | null) => arrived !== null && lastCommitAt > arrived;

function startGuard(g: Guard) {
  active?.();
  performance.clearResourceTimings();
  const started = performance.now();
  const stop = () => {
    window.clearInterval(timer);
    if (active === stop) active = null;
  };
  const timer = window.setInterval(() => {
    const arrived = g.arrivedAt();
    if (g.settled(arrived) || performance.now() - started > GIVE_UP_MS) return stop();
    const ago = arrived === null ? 0 : performance.now() - arrived;
    if (arrived !== null && ago > SETTLE_MS && document.visibilityState === "visible") {
      stop();
      console.warn(`[raspison] ${g.label} не завершился за ${Math.round(ago)} мс после ответа, восстанавливаемся`);
      g.recover();
    }
  }, TICK_MS);
  active = stop;
}

/** Следить за переходом на href (клик по ссылке, router.push/replace). */
export function watchNavigation(href: string) {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return;
  }
  if (url.origin !== location.origin || url.href === location.href) return;
  const from = location.href;
  startGuard({
    arrivedAt: () => arrivedAt(url.pathname, true),
    settled: (arrived) => location.href !== from || committedAfter(arrived),
    recover: () => location.assign(url.href),
    label: `переход на ${url.pathname}`,
  });
}

/** Следить за router.refresh(): успех — новое дерево применилось. */
export function watchRefresh() {
  const from = location.href;
  const pathname = location.pathname;
  startGuard({
    arrivedAt: () => arrivedAt(pathname, true),
    settled: (arrived) => location.href !== from || committedAfter(arrived),
    recover: () => location.reload(),
    label: "refresh",
  });
}

/**
 * Следить за отправкой формы с server action: успех — переход, новое дерево или снова активная кнопка.
 * Если действие велело перейти (redirect), уходим по этому адресу, иначе перезагружаем страницу.
 */
function watchForm(form: HTMLFormElement) {
  const from = location.href;
  const startedAt = performance.now();
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  startGuard({
    arrivedAt: () => (lastAction && lastAction.at >= startedAt ? lastAction.at : null),
    settled: (arrived) => location.href !== from || committedAfter(arrived) || button === null || !button.disabled || !form.isConnected,
    recover: () => {
      const to = lastAction?.redirect;
      if (to) location.assign(new URL(to, location.href).href);
      else location.reload();
    },
    label: "отправка формы",
  });
}

function onClick(e: MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
  if (!a.href.startsWith(location.origin)) return;
  const url = new URL(a.href);
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === location.pathname && url.search === location.search) return; // тот же экран или якорь
  watchNavigation(url.href);
}

function onSubmit(e: SubmitEvent) {
  if (e.target instanceof HTMLFormElement) watchForm(e.target);
}

/** Ставится в лэйаут один раз: слушает клики и отправки форм в фазе перехвата, считает коммиты. */
export function NavWatchdog() {
  useLayoutEffect(() => {
    lastCommitAt = performance.now();
  });
  useEffect(() => {
    try {
      performance.setResourceTimingBufferSize(600);
    } catch {
      // старые браузеры
    }
    wrapFetch();
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);
  return null;
}

/** useRouter, чьи push/replace/refresh под присмотром сторожа. */
export function useGuardedRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();
  return useMemo(
    () => ({
      ...router,
      push: (href, opts) => {
        watchNavigation(href);
        router.push(href, opts);
      },
      replace: (href, opts) => {
        watchNavigation(href);
        router.replace(href, opts);
      },
      refresh: () => {
        watchRefresh();
        router.refresh();
      },
    }),
    [router],
  );
}
