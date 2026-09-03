import Link from "next/link";
import { Ghost } from "lucide-react";

/** «Не найдено» внутри приложения: с таб-баром, чтобы не потерять навигацию в установленной PWA. */
export default function AppNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pt-24 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-muted">
        <Ghost className="size-7" />
      </div>
      <h1 className="font-display text-2xl font-bold">Тут ничего нет</h1>
      <p className="max-w-xs text-[15px] leading-relaxed text-muted">Запись удалена или ссылка устарела.</p>
      <Link href="/hw" className="rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink active:bg-accent-press">
        К домашке
      </Link>
    </div>
  );
}
