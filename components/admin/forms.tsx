"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useState, useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Кнопка отправки формы с индикатором ожидания server action.
 * До гидратации кнопка выключена: иначе форма уходит нативным POST, React потом «переигрывает» его,
 * и на медленном устройстве это зависает без редиректа. Наши пользователи всегда с JS, теряем только no-JS.
 */
export function SubmitButton(props: ButtonProps) {
  const { pending } = useFormStatus();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return <Button type="submit" loading={pending} {...props} disabled={!ready || props.disabled} />;
}

/** Кнопка опасного действия с подтверждением через confirm(). */
export function ConfirmButton({
  action,
  confirmText,
  children,
  ...props
}: Omit<ButtonProps, "onClick"> & { action: () => Promise<unknown>; confirmText: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button
      type="button"
      loading={pending}
      onClick={() => {
        if (window.confirm(confirmText))
          start(async () => {
            const res = (await action()) as { ok?: boolean; error?: string } | undefined;
            if (res && res.ok === false) toast(res.error ?? "Не получилось");
          });
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
