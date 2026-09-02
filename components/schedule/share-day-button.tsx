"use client";

import { useState } from "react";
import { Check, Loader2, Share2 } from "lucide-react";

/** «Поделиться днём»: сервер рендерит PNG-карточку, Web Share отправляет её файлом в ВК/Telegram; без Web Share — открываем картинку. */
export function ShareDayButton({ date }: { date: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const share = async () => {
    setState("busy");
    try {
      const res = await fetch(`/api/share/day?date=${date}`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], `raspison-${date}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "Расписание на день" });
      } else {
        window.open(URL.createObjectURL(blob), "_blank", "noopener");
      }
      setState("done");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("idle");
    }
  };
  return (
    <button type="button" onClick={share} aria-label="Поделиться днём" disabled={state === "busy"} className="grid size-9 place-items-center rounded-full text-muted active:bg-surface-2">
      {state === "busy" ? <Loader2 className="size-5 animate-spin" /> : state === "done" ? <Check className="size-5 text-accent" /> : <Share2 className="size-5" />}
    </button>
  );
}
