"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { WifiOff } from "lucide-react";

/** Плашка «нет сети» на всех экранах, кроме расписания (у него своя, с датой данных). */
export function NetStatus() {
  const pathname = usePathname();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline || pathname === "/s" || pathname.startsWith("/s/")) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-20 flex justify-center" style={{ top: "calc(var(--sat) + 0.5rem)" }}>
      <div className="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-muted shadow-float hairline">
        <WifiOff className="size-3.5" />
        Нет сети — показываю сохранённое
      </div>
    </div>
  );
}
