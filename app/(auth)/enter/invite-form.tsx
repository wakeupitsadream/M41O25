"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { submitInviteCode } from "./actions";

export function InviteForm() {
  const [state, action, pending] = useActionState(submitInviteCode, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Код группы" error={state?.error}>
        <Input
          name="code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="M41-XXXX"
          className="h-14 text-center font-display text-xl tracking-[0.15em] uppercase"
          required
          autoFocus
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Дальше <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}
