"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CloudUpload, Loader2 } from "lucide-react";
import { createHomework } from "@/app/(app)/hw/actions";
import { useGuardedRouter } from "@/components/features/nav-guard";
import { useToast } from "@/components/ui/toast";
import {
  isOfflineError,
  markQueueFailed,
  markQueueRetry,
  myQueue,
  pruneQueue,
  QUEUE_EVENT,
  queueLabel,
  queueToSend,
  readDraft,
  readQueue,
  removeFromQueue,
  saveDraft,
  writeQueue,
  type QueuedHw,
} from "@/lib/hw/draft";

const online = () => (typeof navigator === "undefined" ? true : navigator.onLine);

/**
 * Отложенная отправка домашки: записи, не ушедшие из-за отсутствия сети (components/hw/quick-add-form.tsx),
 * ждут в localStorage и уходят сами — при появлении сети, при возвращении на экран и при запуске приложения.
 * Пока очередь не пуста, человек видит плашку с числом записей и может отправить их вручную.
 *
 * Дубли исключены на сервере (createHomework сверяет автора, текст, дедлайн и предмет за последние минуты),
 * поэтому повторить отправку не страшно: в худшем случае вернётся id уже созданной записи.
 *
 * Где плашка стоит на экране, решает колонка верхних плашек в app/(app)/layout.tsx — здесь ни fixed, ни отступов.
 */
export function HwOutbox({ meId }: { meId: string }) {
  const router = useGuardedRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [mine, setMine] = useState<QueuedHw[]>([]);
  const [sending, setSending] = useState(false);
  // Единственная отправка за раз: событие online и возвращение на экран приходят почти одновременно.
  const busy = useRef(false);

  const sync = useCallback(() => {
    const list = readQueue();
    const kept = pruneQueue(list, Date.now());
    if (kept.length !== list.length) writeQueue(kept);
    setMine(myQueue(kept, meId));
  }, [meId]);

  const flush = useCallback(
    async (manual: boolean) => {
      if (busy.current) return;
      if (!manual && !online()) return sync();
      const todo = queueToSend(pruneQueue(readQueue(), Date.now()), meId, manual);
      if (!todo.length) return sync();

      busy.current = true;
      setSending(true);
      let sent = 0;
      let lost = false;
      let refused: string | null = null;
      for (const e of todo) {
        try {
          const res = await createHomework({
            body: e.body,
            title: e.title,
            subjectId: e.subjectId,
            dueDate: e.dueDate,
            lessonId: e.lessonId,
            attachmentIds: e.attachmentIds,
            // Момент постановки в очередь: сервер считает от него окно дедупликации, иначе повтор после
            // многочасовой заморозки PWA создаст второй такой же ДЗ (app/(app)/hw/actions.ts).
            queuedAt: e.queuedAt > 0 ? Math.floor(e.queuedAt) : undefined,
          });
          // Очередь перечитываем на каждом шаге: пока идёт отправка, человек мог добавить ещё одну запись.
          const cur = pruneQueue(readQueue(), Date.now());
          if (res.ok) {
            sent++;
            writeQueue(removeFromQueue(cur, e.key));
          } else {
            refused = res.error;
            writeQueue(markQueueFailed(cur, e.key, res.error));
          }
        } catch (err) {
          const cur = pruneQueue(readQueue(), Date.now());
          if (isOfflineError(err, online())) {
            // Сеть снова пропала: запись остаётся в очереди и уйдёт сама. Остальные ждут — смысла долбиться нет.
            lost = true;
            writeQueue(markQueueRetry(cur, e.key));
            break;
          }
          writeQueue(markQueueFailed(cur, e.key, "Не отправилось"));
          refused = "Не отправилось";
        }
      }
      busy.current = false;
      setSending(false);
      sync();
      if (sent) {
        toast(sent === 1 ? "Отправил домашку" : `Отправил домашку: ${sent}`, "ok");
        router.refresh();
      }
      if (refused) toast(refused);
      else if (manual && !sent && lost) toast("Всё ещё нет сети — отправлю, когда появится");
    },
    [meId, router, sync, toast],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- очередь лежит в localStorage: на сервере её нет, прочитать можно только после монтирования.
    sync();
    void flush(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush(false);
    };
    const onOnline = () => void flush(false);
    window.addEventListener(QUEUE_EVENT, sync);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(QUEUE_EVENT, sync);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [flush, sync]);

  /**
   * Сервер отверг запись (слишком длинный текст, удалённый предмет) — сама она больше не уйдёт и висела бы
   * плашкой неделю до конца TTL. Не стираем её молча: возвращаем текст в черновик и уводим человека в форму,
   * где его видно и можно поправить.
   */
  const fixFailed = (e: QueuedHw) => {
    if (readDraft(meId)) {
      // На /hw/new уже начата другая запись — затирать её нельзя. Запись остаётся в очереди.
      toast("Сначала разберись с тем, что уже набрано в «Что задали?»");
      router.push("/hw/new");
      return;
    }
    if (!saveDraft({ userId: meId, body: e.body, title: e.title, subjectId: e.subjectId, dueOverride: e.dueDate, savedAt: Date.now() })) {
      // Хранилище отказало: из очереди запись не убираем, иначе текст пропал бы совсем.
      toast("Не вышло открыть запись — на телефоне нет места");
      return;
    }
    writeQueue(removeFromQueue(pruneQueue(readQueue(), Date.now()), e.key));
    // Форма уже открыта на этом экране: она перечитывает черновик только при монтировании, а её пустое состояние
    // затёрло бы только что записанное. Поэтому перезагружаем экран (офлайн его отдаст service worker).
    if (pathname === "/hw/new") window.location.reload();
    else router.push("/hw/new");
  };

  if (!mine.length) return null;
  const failed = mine.find((e) => e.lastError);

  return (
    <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-surface-2 py-1.5 pl-3.5 pr-1.5 shadow-float hairline">
      {sending ? <Loader2 className="size-3.5 shrink-0 animate-spin text-muted" /> : <CloudUpload className="size-3.5 shrink-0 text-muted" />}
      <span className="truncate text-[12px] font-medium text-muted">{failed?.lastError ?? queueLabel(mine.length)}</span>
      {failed && (
        <button type="button" onClick={() => fixFailed(failed)} className="h-10 shrink-0 rounded-full px-3 text-[13px] font-semibold text-muted">
          Исправить
        </button>
      )}
      <button
        type="button"
        onClick={() => void flush(true)}
        disabled={sending}
        className="h-10 shrink-0 rounded-full px-3.5 text-[13px] font-semibold text-accent disabled:opacity-50"
      >
        {sending ? "Шлю…" : "Отправить"}
      </button>
    </div>
  );
}
