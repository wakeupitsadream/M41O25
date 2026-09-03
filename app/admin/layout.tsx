import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { RefreshOnResume } from "@/components/features/refresh-on-resume";
import { NavWatchdog } from "@/components/features/nav-guard";
import { ToastProvider } from "@/components/ui/toast";

export const metadata = { title: "Админка" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("moderator");
  return (
    <ToastProvider>
    <div className="mx-auto min-h-dvh w-full max-w-lg pb-12">
      <NavWatchdog />
      <RefreshOnResume />
      <header className="flex items-center gap-2 px-3 pt-safe pb-2">
        <Link href="/me" className="flex h-10 items-center gap-1 rounded-full pl-2 pr-3.5 text-[15px] font-medium text-muted active:bg-surface-2">
          <ChevronLeft className="size-5" /> Профиль
        </Link>
        <div className="flex-1" />
        <span className="rounded-full bg-accent/15 px-3 py-1 text-[12px] font-semibold text-accent">{user.role === "admin" ? "Админ" : "Староста"}</span>
      </header>
      <AdminNav role={user.role} />
      <div className="px-5 pt-4">{children}</div>
    </div>
    </ToastProvider>
  );
}
