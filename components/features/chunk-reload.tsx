"use client";

import { useEffect } from "react";

/**
 * После деплоя старые чанки /_next/static исчезают, а открытая на iPhone PWA живёт часами.
 * Ловим ChunkLoadError и один раз перезагружаем страницу — вместо белого экрана.
 */
export function ChunkReload() {
  useEffect(() => {
    const KEY = "raspison.chunk-reload";
    const isChunkError = (msg: unknown) => typeof msg === "string" && /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
    const reloadOnce = () => {
      try {
        const last = Number(sessionStorage.getItem(KEY) ?? 0);
        if (Date.now() - last < 30_000) return;
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {}
      window.location.reload();
    };
    const onError = (e: ErrorEvent) => isChunkError(e.message) && reloadOnce();
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; name?: string } | undefined;
      if (isChunkError(r?.message) || r?.name === "ChunkLoadError") reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
