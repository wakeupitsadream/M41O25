import Link from "next/link";
import { Ghost } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-muted">
        <Ghost className="size-7" />
      </div>
      <h1 className="font-display text-2xl font-bold">Тут ничего нет</h1>
      <p className="max-w-xs text-[15px] leading-relaxed text-muted">Запись удалена или ссылка устарела.</p>
      <div className="flex gap-2 pt-2">
        <Link href="/s" className="rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink active:bg-accent-press">
          К расписанию
        </Link>
        <Link href="/hw" className="rounded-full bg-surface-2 px-6 py-3 font-semibold text-fg hairline">
          Домашка
        </Link>
      </div>
    </main>
  );
}
