"use client";

import { useEffect, useState } from "react";
import { Compass, Share, Smartphone, SquarePlus } from "lucide-react";

type Mode = "standalone" | "inapp" | "browser" | "desktop";

/**
 * Онбординг на экране входа: «сначала установи, потом войди». У установленного приложения на iPhone своя память
 * (cookie), поэтому вход из Safari пропадает после установки — предупреждаем заранее. Внутри ВК/Telegram
 * поставить приложение нельзя вовсе — просим открыть ссылку в Safari.
 */
function detect(): Mode {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return "standalone";
  const ipad = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
  const ios = /iPhone|iPad|iPod/.test(ua) || ipad;
  const android = /Android/.test(ua);
  if (!ios && !android) return "desktop";
  const inApp = /VKAndroidApp|VKApp|VK\/|Telegram|FBAN|FBAV|Instagram|OKApp|Viber/i.test(ua) || (ios && !/Safari\//.test(ua)) || (android && /; wv\)/.test(ua));
  return inApp ? "inapp" : "browser";
}

export function EnterInstallHint() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [ios, setIos] = useState(true);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setMode(detect());
      setIos(/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent));
      setHidden(sessionStorage.getItem("raspison.enter.hint") === "1");
    } catch {
      setMode("desktop");
    }
  }, []);

  if (!mode || mode === "desktop" || hidden) return null;

  if (mode === "standalone") {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-surface px-3.5 py-3 text-[13px] leading-relaxed text-muted hairline">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-accent" />
        <span>Это установленное приложение. Введи код группы ещё раз, дальше вход будет по PIN.</span>
      </p>
    );
  }

  const skip = () => {
    setHidden(true);
    try {
      sessionStorage.setItem("raspison.enter.hint", "1");
    } catch {}
  };

  if (mode === "inapp") {
    return (
      <div className="rounded-lg bg-accent/10 p-4 ring-1 ring-accent/30">
        <div className="font-display text-[15px] font-bold">Открой ссылку в {ios ? "Safari" : "браузере"}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Ссылка открылась внутри другого приложения, отсюда Raspison на экран не поставить. Нажми «⋯» или «Поделиться» → «Открыть в {ios ? "Safari" : "браузере"}», потом вернись к коду.
        </p>
        <button type="button" onClick={skip} className="mt-3 text-[13px] font-medium text-muted underline-offset-4 hover:underline">
          Просто войти здесь
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-accent/10 p-4 ring-1 ring-accent/30">
      <div className="font-display text-[15px] font-bold">Сначала установи, потом войди</div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">У приложения на телефоне своя память: если войти сейчас, после установки код попросят ещё раз.</p>
      <ol className="mt-3 space-y-1.5 text-[13px]">
        <li className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-accent">
            <Share className="size-3.5" />
          </span>
          {ios ? "Нажми «Поделиться» внизу Safari" : "Открой меню браузера (⋮)"}
        </li>
        <li className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-accent">
            <SquarePlus className="size-3.5" />
          </span>
          {ios ? "Выбери «На экран „Домой“»" : "Выбери «Добавить на главный экран»"}
        </li>
        <li className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-accent">
            <Compass className="size-3.5" />
          </span>
          Открой иконку Raspison и введи код там
        </li>
      </ol>
      <button type="button" onClick={skip} className="mt-3 text-[13px] font-medium text-muted underline-offset-4 hover:underline">
        Уже установил или хочу просто войти
      </button>
    </div>
  );
}
