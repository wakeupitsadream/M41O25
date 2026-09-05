"use client";

import { useEffect } from "react";
import { markFeedSeen } from "@/app/(app)/group/actions";

/**
 * Открыл ленту — считаем прочитанной всё до момента её рендера (`renderedAt`), а не «до сейчас»:
 * событие, вставшее между рендером и отметкой, останется новым. Отдельно от «был онлайн», чтобы точки
 * не гасли раньше времени. Каждая порция «Показать ещё» рендерится заново и двигает порог вперёд.
 */
export function MarkSeen({ renderedAt }: { renderedAt: string }) {
  useEffect(() => {
    const t = setTimeout(() => void markFeedSeen(renderedAt), 1200);
    return () => clearTimeout(t);
  }, [renderedAt]);
  return null;
}
