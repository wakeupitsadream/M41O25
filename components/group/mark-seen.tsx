"use client";

import { useEffect } from "react";
import { markFeedSeen } from "@/app/(app)/group/actions";

/** Открыл ленту — считаем прочитанной. Отдельно от «был онлайн», чтобы точки не гасли раньше времени. */
export function MarkSeen() {
  useEffect(() => {
    const t = setTimeout(() => void markFeedSeen(), 1200);
    return () => clearTimeout(t);
  }, []);
  return null;
}
