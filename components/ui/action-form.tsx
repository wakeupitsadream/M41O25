"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/form";
import { cn } from "@/lib/utils";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * Форма для server action с состоянием: ошибка валидации показывается прямо под полями,
 * а не полноэкранным «Что-то пошло не так» с потерей введённого. Успех — редиректом или success-текстом.
 */
export function ActionForm({ action, className, children }: { action: Action; className?: string; children: React.ReactNode }) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && (
        <p role="alert" className={cn("rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger")}>
          {state.error}
        </p>
      )}
      {state?.success && <p role="status" className="rounded-md bg-ok/10 px-3 py-2 text-[13px] text-ok">{state.success}</p>}
    </form>
  );
}
