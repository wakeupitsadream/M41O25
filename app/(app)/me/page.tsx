import Link from "next/link";
import { ChevronRight, LogOut, ShieldCheck } from "lucide-react";
import { requireUser, hasRole } from "@/lib/auth";
import { Avatar, PageHeader } from "@/components/ui/primitives";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/forms";
import { changePin, logout, toggleShowHwDone, updateProfile } from "./actions";
import { ActionForm } from "@/components/ui/action-form";
import { cn } from "@/lib/utils";
import { InstallHint } from "@/components/features/install-hint";

export const metadata = { title: "Профиль" };

export default async function MePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Профиль" subtitle={user.group.shortName} />
      <div className="space-y-4 px-5">
        <InstallHint />
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

        <Card>
          <form action={updateProfile} className="space-y-3">
            <div className="font-display text-[16px] font-bold">О себе</div>
            <div className="grid grid-cols-[1fr_5rem] gap-3">
              <Field label="Как тебя называть">
                <Input name="nickname" defaultValue={user.nickname ?? ""} placeholder="Ник" />
              </Field>
              <Field label="Эмодзи">
                <Input name="avatarEmoji" defaultValue={user.avatarEmoji} className="text-center text-xl" maxLength={8} />
              </Field>
            </div>
            <Field label="День рождения" hint="Покажем группе в разделе «Дни рождения». Можно не указывать.">
              <Input type="date" name="birthday" defaultValue={user.birthday ?? ""} />
            </Field>
            <SubmitButton variant="secondary" className="w-full">
              Сохранить
            </SubmitButton>
          </form>
        </Card>

        <Card>
          <ActionForm action={changePin} className="space-y-3">
            <div className="font-display text-[16px] font-bold">Сменить PIN</div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Текущий">
                <Input name="current" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="current-password" required className="text-center tracking-widest" />
              </Field>
              <Field label="Новый">
                <Input name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="new-password" required className="text-center tracking-widest" />
              </Field>
              <Field label="Ещё раз">
                <Input name="pin2" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="new-password" required className="text-center tracking-widest" />
              </Field>
            </div>
            <SubmitButton variant="secondary" className="w-full">
              Сменить PIN
            </SubmitButton>
          </ActionForm>
        </Card>

        <p className="px-1 text-[12px] leading-relaxed text-dim">Удалиться из группы — напиши админу: он убирает профиль из списка, записи остаются без имени.</p>

        <form action={logout}>
          <button type="submit" className="flex w-full items-center gap-3 rounded-lg bg-surface p-4 text-danger hairline active:bg-surface-2">
            <LogOut className="size-5" />
            <span className="flex-1 text-left font-medium">Выйти на этом устройстве</span>
          </button>
        </form>

        <form action={toggleShowHwDone} className="pt-6">
          <button type="submit" className="mx-auto flex items-center gap-2 text-[12px] text-dim">
            <span className={cn("inline-block size-2 rounded-full", user.showHwDone ? "bg-accent" : "bg-border-strong")} />
            личные отметки «сделал» {user.showHwDone ? "включены" : "выключены"}
          </button>
        </form>
      </div>
    </>
  );
}
