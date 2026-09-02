"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { claimProfile, loginWithPin } from "../actions";

const pinInput = "h-14 text-center font-display text-2xl tracking-[0.5em]";

export function PinForm({ userId, claimed }: { userId: string; claimed: boolean }) {
  const [state, action, pending] = useActionState(claimed ? loginWithPin : claimProfile, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <Field label={claimed ? "PIN" : "Новый PIN"} error={state?.error}>
        <Input
          name="pin"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          autoComplete={claimed ? "current-password" : "new-password"}
          placeholder="••••"
          className={pinInput}
          required
          autoFocus
        />
      </Field>
      {!claimed && (
        <Field label="Ещё раз">
          <Input name="pin2" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="new-password" placeholder="••••" className={pinInput} required />
        </Field>
      )}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {claimed ? "Войти" : "Готово"}
      </Button>
      <Link href="/enter/who" className="block text-center text-[14px] text-muted underline-offset-4 hover:underline">
        Это не я
      </Link>
    </form>
  );
}
