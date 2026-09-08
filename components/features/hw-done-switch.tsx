"use client";

import { useOptimistic, useTransition } from "react";
import { toggleShowHwDone } from "@/app/(app)/me/actions";
import { SwitchRow } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

/** Тумблер личных отметок «сделал»: переключается сразу, при ошибке — тост и возврат состояния. */
export function HwDoneSwitch({ value }: { value: boolean }) {
  const [checked, setChecked] = useOptimistic(value);
  const [, start] = useTransition();
  const toast = useToast();

  return (
    <SwitchRow
      checked={checked}
      onChange={(next) =>
        start(async () => {
          setChecked(next);
          try {
            const res = await toggleShowHwDone(next);
            if (!res.ok) toast(res.error);
          } catch {
            // Нет сети: оптимистичное значение откатится само, когда переход закончится.
            toast("Не сохранилось — нет сети");
          }
        })
      }
      label="Личные отметки «сделал»"
      hint="Галочка на домашке видна только тебе. Никто в группе её не видит."
    />
  );
}
