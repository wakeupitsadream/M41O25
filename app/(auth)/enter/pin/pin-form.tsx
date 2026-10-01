"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { claimProfile, loginWithPin } from "../actions";

// Цифры маскируем через -webkit-text-security, а не type="password": остаётся цифровая клавиатура (inputMode),
// а iOS не предлагает сохранить PIN в Связку ключей как пароль сайта без логина.
const pinInput = "h-14 text-center font-display text-2xl tracking-[0.5em] [-webkit-text-security:disc]";

export function PinForm({ userId, claimed }: { userId: string; claimed: boolean }) {
  const [state, action, pending] = useActionState(claimed ? loginWithPin : claimProfile, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <Field label={claimed ? "PIN" : "Новый PIN"} error={state?.error}>
        {/* autoComplete="off": PIN — не одноразовый код из СМС (one-time-code подсовывал бы коды из «Сообщений»)
            и не пароль (new-password вызывает генератор стойкого пароля для поля в 4 цифры). */}
        <Input name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" placeholder="••••" className={pinInput} required autoFocus />
      </Field>
      {!claimed && (
        <Field label="Ещё раз">
          <Input name="pin2" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" placeholder="••••" className={pinInput} required />
        </Field>
      )}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {claimed ? "Войти" : "Готово"}
      </Button>
      {/* Подчёркивание всегда: hover: на iPhone не срабатывает (Tailwind заворачивает его в @media (hover: hover)). */}
      <Link href="/enter/who" className="flex min-h-11 items-center justify-center text-[14px] text-muted underline decoration-dim underline-offset-4">
        Это не я
      </Link>
    </form>
  );
}
