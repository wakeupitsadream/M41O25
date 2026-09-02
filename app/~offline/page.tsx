import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata = { title: "Нет сети" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-muted">
        <WifiOff className="size-7" />
      </div>
      <h1 className="font-display text-2xl font-bold">Нет сети</h1>
      <p className="max-w-xs text-muted">Расписание открывается и без интернета — открой его с главного экрана. Остальное подтянется, когда появится связь.</p>
      <Link href="/s" className="mt-2 rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink active:bg-accent-press">
        К расписанию
      </Link>
    </main>
  );
}
