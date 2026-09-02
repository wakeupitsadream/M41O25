import Link from "next/link";
import { ChevronRight, LogOut, ShieldCheck } from "lucide-react";
import { requireUser, hasRole } from "@/lib/auth";
import { Avatar, PageHeader } from "@/components/ui/primitives";
import { Card } from "@/components/ui/card";
import { logout } from "./actions";

export const metadata = { title: "Профиль" };

export default async function MePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Профиль" subtitle={user.group.shortName} />
      <div className="space-y-4 px-5">
        <Card className="flex items-center gap-4">
          <Avatar user={user} size="lg" />
          <div className="min-w-0">
            <div className="truncate font-display text-lg font-bold">{user.fullName}</div>
            <div className="text-[13px] text-muted">
              {user.role === "admin" ? "Админ" : user.role === "moderator" ? "Староста" : "Студент"}
              {user.nickname && ` · ${user.nickname}`}
            </div>
          </div>
        </Card>
        {hasRole(user, "moderator") && (
          <Link href="/admin" className="flex items-center gap-3 rounded-lg bg-surface p-4 hairline active:bg-surface-2">
            <ShieldCheck className="size-5 text-accent" />
            <span className="flex-1 font-medium">Админка</span>
            <ChevronRight className="size-4 text-dim" />
          </Link>
        )}
        <form action={logout}>
          <button type="submit" className="flex w-full items-center gap-3 rounded-lg bg-surface p-4 text-danger hairline active:bg-surface-2">
            <LogOut className="size-5" />
            <span className="flex-1 text-left font-medium">Выйти на этом устройстве</span>
          </button>
        </form>
      </div>
    </>
  );
}
