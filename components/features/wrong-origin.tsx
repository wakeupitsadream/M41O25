"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import { APP_ORIGIN, hrefOnOrigin, originStatus } from "@/lib/origin";

type Target = { host: string; href: string };

/**
 * Предупреждение «это не рабочий адрес». Preview-деплой выглядит как настоящее приложение и точно так же
 * ставится на домашний экран, но живёт без базы и умирает молча — человек считает, что сломалось приложение.
 *
 * Проверяется на клиенте: адрес знает только браузер, а установленная PWA навсегда привязана к тому адресу,
 * с которого её поставили. Ссылка ведёт на тот же путь рабочего домена — уйти можно одним тапом, работу на
 * preview не блокируем, он нужен для проверок.
 */
function useWorkOrigin(): Target | null {
  const pathname = usePathname();
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    const status = originStatus(APP_ORIGIN, window.location.origin);
    const next: Target | null =
      status.kind === "foreign" ? { host: status.host, href: hrefOnOrigin(status.expected, window.location.pathname + window.location.search) } : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Текущий адрес есть только в браузере: на сервере window нет, а вся плашка зависит именно от него.
    setTarget(next);
  }, [pathname]);

  return target;
}

/**
 * Компактная плашка для экранов внутри приложения. Позиционирование даёт контейнер верхних плашек
 * в app/(app)/layout.tsx — здесь ни fixed, ни z-index. Вся строка — ссылка высотой не меньше 40px.
 */
export function WrongOriginBanner() {
  const target = useWorkOrigin();
  if (!target) return null;
  return (
    <a
      href={target.href}
      className="pointer-events-auto flex min-h-10 w-full items-center gap-2.5 rounded-2xl bg-surface-2 py-2 pl-3.5 pr-2 shadow-float ring-1 ring-warn/40 active:bg-surface-3"
    >
      <TriangleAlert className="size-4 shrink-0 text-warn" />
      <span className="flex-1 text-[12px] leading-snug text-fg">
        Это тестовая копия. Рабочее приложение — <span className="font-semibold text-warn">{target.host}</span>
      </span>
      <span className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-warn px-3 text-[12px] font-semibold text-accent-ink">
        Открыть <ArrowUpRight className="size-3.5" />
      </span>
    </a>
  );
}

/**
 * Развёрнутое предупреждение для экрана входа: именно здесь человек ставит приложение на домашний экран
 * и «прикипает» к адресу, поэтому текст прямой, а кнопка — крупная.
 */
export function WrongOriginNotice({ className }: { className?: string }) {
  const target = useWorkOrigin();
  if (!target) return null;
  return (
    <div className={`rounded-2xl bg-warn/10 p-4 ring-1 ring-warn/40 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0 text-warn" />
        <div className="font-display text-[15px] font-bold text-warn">Ты открыл тестовую копию</div>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        Устанавливай приложение только с рабочего адреса <span className="font-semibold text-fg">{target.host}</span>. Установленное отсюда однажды перестанет
        работать, и починить это можно будет только переустановкой.
      </p>
      <a
        href={target.href}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-warn px-5 text-[15px] font-semibold text-accent-ink active:opacity-90"
      >
        Перейти на {target.host} <ArrowUpRight className="size-4" />
      </a>
    </div>
  );
}
