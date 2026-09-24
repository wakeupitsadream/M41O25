"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import type { LimitsView } from "@/lib/assistant/types";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[13px] font-medium uppercase tracking-wide text-muted">{title}</h3>
      <div className="mt-1.5 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

/**
 * «Как это работает»: что умеет, что видит и — честно — куда уходят данные (решение владельца: в подсказке прямо
 * говорим о передаче провайдерам). Лимиты берём из настроек группы, а не пишем числа в текст.
 */
export function HowItWorks({ limits }: { limits: LimitsView | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="h-10 rounded-full px-3.5 text-[14px] font-medium text-muted active:bg-surface-2">
        Как это работает
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Как это работает">
        <div className="space-y-5 pb-2">
          <Block title="Что умеет">
            Объясняет темы, решает задачи с коротким ходом решения, читает фото (конспект, задание с доски) и документы: PDF, Word, Excel, PowerPoint, txt —
            до 4 файлов по 4 МБ в сообщении.
          </Block>
          <Block title="Что видит">
            То же, что ты в приложении: расписание, домашку, новости, опросы, задачи, контакты, дни рождения без года, список группы. Не видит отметки
            «сделано», PIN-коды и чужие чаты. Одногруппники твои беседы тоже не видят.
          </Block>
          {limits && (
            <Block title="Лимиты">
              {limits.day.limit} сообщений в день и {limits.week.limit} в неделю. Вопрос с фото или документом — одно сообщение. Сильный режим отвечает
              умнее, но медленнее: {limits.strong.limit} в неделю, и каждое такое сообщение считается ещё и в обычном лимите.
            </Block>
          )}
          <Block title="Куда уходят данные">
            Ответы генерирует ИИ через PolzaAI. Текст и файлы уходят на серверы OpenAI, Google или Anthropic за пределами России — не отправляй паспортные
            данные и чужие персональные данные.
          </Block>
          <p className="text-[13px] leading-snug text-dim">ИИ ошибается. Даты, формулы и ответы к контрольным проверяй.</p>
        </div>
      </Sheet>
    </>
  );
}
