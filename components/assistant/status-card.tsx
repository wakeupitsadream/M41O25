"use client";

import { useState, useTransition } from "react";
import { Copy, Sparkles } from "lucide-react";
import { startTrial } from "@/app/(app)/group/assistant/actions";
import { useGuardedRouter } from "@/components/features/nav-guard";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { daysWord, ddmm } from "@/lib/assistant/client/format";
import type { AssistantState } from "@/lib/assistant/types";

/** «Как оплатить»: цена, реквизиты из админки и честно — доступ включает человек, а не автомат. */
function PaymentSheet({ open, onClose, priceRub, paymentNote }: { open: boolean; onClose: () => void; priceRub: number; paymentNote: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(paymentNote);
      toast("Реквизиты скопированы", "ok");
    } catch {
      toast("Не скопировалось — выдели текст пальцем");
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Как оплатить">
      <div className="space-y-4 pb-2">
        <div className="font-display text-[26px] font-bold leading-none">
          {priceRub} ₽ <span className="text-[15px] font-medium text-muted">за 30 дней</span>
        </div>
        {paymentNote ? (
          <div className="rounded-md bg-surface-2 p-4 hairline">
            <p className="select-text whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">{paymentNote}</p>
            <button type="button" onClick={copy} className="-mb-2 -ml-2 mt-1 flex h-10 items-center gap-1.5 rounded-full px-2 text-[14px] font-semibold text-muted active:bg-surface-3">
              <Copy className="size-4" /> Скопировать
            </button>
          </div>
        ) : (
          <p className="text-[15px] leading-relaxed text-muted">Реквизиты админ пока не указал — спроси у него напрямую.</p>
        )}
        <p className="text-[15px] leading-relaxed">После перевода напиши админу — доступ включается вручную. Если оплатишь заранее, дни прибавятся к текущим.</p>
        <Button variant="secondary" className="w-full" onClick={onClose}>
          Понятно
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Карточка доступа по AccessStatus (docs/AI-CHAT.md §2): none — крупная кнопка триала (отсчёт идёт с нажатия,
 * чтобы человек знал, когда он начался), trial/paid — «до …», expired — цена и «Как оплатить».
 */
export function StatusCard({ state }: { state: AssistantState }) {
  const router = useGuardedRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const { access, settings } = state;
  const sheet = <PaymentSheet open={payOpen} onClose={() => setPayOpen(false)} priceRub={settings.priceRub} paymentNote={settings.paymentNote} />;

  const begin = () =>
    start(async () => {
      setError(null);
      const res = await startTrial();
      if (!res.ok) return setError(res.error);
      router.refresh();
    });

  if (access.kind === "none") {
    return (
      <div className="rounded-lg bg-surface p-5 hairline">
        <Sparkles className="size-6 text-muted" />
        <h2 className="mt-3 font-display text-[20px] font-bold leading-tight">Помощник по учёбе</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Объяснит тему, разберёт задачу с ходом решения, прочитает фото конспекта и документы. Знает расписание и домашку группы.
        </p>
        {settings.trialDays > 0 ? (
          <>
            <Button size="lg" className="mt-4 w-full" loading={pending} onClick={begin}>
              Попробовать {settings.trialDays} {daysWord(settings.trialDays)} бесплатно
            </Button>
            <p className="mt-2 text-center text-[12px] text-dim">Отсчёт пойдёт с нажатия. Потом — {settings.priceRub} ₽ в месяц</p>
          </>
        ) : (
          <>
            <div className="mt-4 font-display text-[22px] font-bold">
              {settings.priceRub} ₽ <span className="text-[15px] font-medium text-muted">в месяц</span>
            </div>
            <Button size="lg" className="mt-3 w-full" onClick={() => setPayOpen(true)}>
              Как оплатить
            </Button>
          </>
        )}
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        {sheet}
      </div>
    );
  }

  if (access.kind === "expired") {
    return (
      <div className="rounded-lg bg-surface p-5 hairline">
        <div className="text-[13px] text-muted">{access.since ? `Доступ закончился ${ddmm(access.since)}` : "Доступ закончился"}</div>
        <div className="mt-1 font-display text-[22px] font-bold">
          {settings.priceRub} ₽ <span className="text-[15px] font-medium text-muted">в месяц</span>
        </div>
        <p className="mt-1 text-[13px] leading-snug text-muted">Переводом, доступ включает админ. Старые беседы остаются — их можно читать.</p>
        <Button size="lg" className="mt-4 w-full" onClick={() => setPayOpen(true)}>
          Как оплатить
        </Button>
        {sheet}
      </div>
    );
  }

  const trial = access.kind === "trial";
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface p-4 hairline">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-muted">{trial ? (settings.trialDays === 7 ? "Пробная неделя" : "Пробный период") : "Доступ оплачен"}</div>
        <div className="mt-0.5 font-display text-[18px] font-bold tnum">до {ddmm(access.until)}</div>
        {trial && <div className="mt-0.5 text-[12px] text-dim">Дальше — {settings.priceRub} ₽ в месяц</div>}
      </div>
      <Button variant="secondary" size="sm" className="h-10" onClick={() => setPayOpen(true)}>
        {trial ? "Как оплатить" : "Продлить"}
      </Button>
      {sheet}
    </div>
  );
}
