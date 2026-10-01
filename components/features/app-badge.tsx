"use client";

import { useEffect } from "react";

/**
 * Бейдж на иконке «Домой» ставит сервис-воркер при пуше (app/sw.ts) — флагом, без числа. Здесь он снимается
 * при каждом показе приложения: человек открыл Raspison — значит, увидел, что нового. Без разрешения на уведомления
 * или вне установленного приложения API нет или промис отклоняется — молча пропускаем.
 */
export function AppBadge() {
  useEffect(() => {
    const clear = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.clearAppBadge?.().catch(() => {});
    };
    clear();
    document.addEventListener("visibilitychange", clear);
    window.addEventListener("pageshow", clear);
    return () => {
      document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("pageshow", clear);
    };
  }, []);
  return null;
}
