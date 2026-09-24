"use client";

import { useId, useState, useTransition } from "react";
import { setPaidUntil } from "@/app/admin/actions/assistant";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * Ручная дата «оплачено до» в карточке человека (docs/AI-CHAT.md §9). Отдельно от «+30 дней»: перенос или
 * исправление срока — не платёж и в выручку не попадает, поэтому это не форма с суммой, а просто дата.
 */
export function AssistantPaidUntil({ userId, current }: { userId: string; current: string | null }) {
  const id = useId();
  const [value, setValue] = useState(current ?? "");
  // После «+30 дней» или «Снять оплату» сервер присылает новую дату — показываем её, а не то, что было при открытии.
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setValue(current ?? "");
  }
  const [pending, start] = useTransition();
  const toast = useToast();

  const save = () =>
    start(async () => {
      try {
        const res = await setPaidUntil(userId, value);
        if (res.ok) toast("Дата сохранена", "ok");
        else toast(res.error);
      } catch {
        // Действие не дошло до сервера (нет сети) — wrapAction тут не поможет, ответ не пришёл вовсе.
        toast("Нет связи — дата не сохранилась");
      }
    });

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-muted">
        Оплачено до — вручную
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <DateInput id={id} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="button" variant="secondary" loading={pending} disabled={!value || value === (current ?? "")} onClick={save}>
          Сохранить дату
        </Button>
      </div>
      <p className="text-[13px] text-dim">Перенос или исправление срока — без платежа, в выручку не идёт.</p>
    </div>
  );
}
