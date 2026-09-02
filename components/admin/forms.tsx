"use client";

import { useFormStatus } from "react-dom";
import { useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Кнопка отправки формы с индикатором ожидания server action. */
export function SubmitButton(props: ButtonProps) {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} {...props} />;
}

/** Кнопка опасного действия с подтверждением через confirm(). */
export function ConfirmButton({
  action,
  confirmText,
  children,
  ...props
}: Omit<ButtonProps, "onClick"> & { action: () => Promise<unknown>; confirmText: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      loading={pending}
      onClick={() => {
        if (window.confirm(confirmText)) start(async () => void (await action()));
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
