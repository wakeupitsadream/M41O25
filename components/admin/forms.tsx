"use client";

import { useFormStatus } from "react-dom";
import { useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Кнопка отправки формы с индикатором ожидания server action. Отправку до гидратации React 19 переигрывает сам
 * (progressive enhancement форм с action); заглушка «кнопка выключена до монтирования» была обходом зависания
 * навигации на Next 15 (docs/ROADMAP.md, «Проблема P0») и снята вместе со сторожем.
 */
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
