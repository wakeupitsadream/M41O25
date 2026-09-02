import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** Шапка подраздела «Группы»: назад к хабу, заголовок, действие справа. */
export function SubHeader({ title, subtitle, right, back = "/group", backLabel = "Группа" }: { title: string; subtitle?: string; right?: React.ReactNode; back?: string; backLabel?: string }) {
  return (
    <div className="px-5">
      <header className="flex items-center gap-2 pt-safe pb-2">
        <Link href={back} className="-ml-2 flex h-10 items-center gap-1 rounded-full pl-2 pr-3.5 text-[15px] font-medium text-muted active:bg-surface-2">
          <ChevronLeft className="size-5" /> {backLabel}
        </Link>
        <div className="flex-1" />
        {right}
      </header>
      <div className="pb-4">
        {subtitle && <div className="mb-1 text-[13px] font-medium uppercase tracking-wide text-muted">{subtitle}</div>}
        <h1 className="font-display text-[28px] font-bold leading-none">{title}</h1>
      </div>
    </div>
  );
}
