"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { removePushSubscription, savePushSubscription, setPushTopics } from "@/app/(app)/me/actions";
import { SwitchRow } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { PUSH_TOPICS, TOPIC_LABELS, type PushTopic } from "@/lib/push/topics";

/**
 * Тумблер пуш-уведомлений. Главная особенность — iPhone: Web Push там живёт ТОЛЬКО в приложении, поставленном
 * на экран «Домой» (iOS 16.4+), и разрешение спрашивается строго по тапу. Поэтому в Safari-вкладке мы не прячем
 * настройку, а объясняем, что надо сначала установить приложение, — иначе человек решит, что уведомлений нет вовсе.
 */
type State = "checking" | "unconfigured" | "unsupported" | "install" | "denied" | "off" | "on";

const HINTS: Record<State, string> = {
  checking: "Проверяем…",
  unconfigured: "Уведомления ещё не настроены на сервере. Напиши админу.",
  unsupported: "Этот браузер не умеет уведомления.",
  install: "На iPhone уведомления работают только у установленного приложения: «Поделиться» → «На экран „Домой“», открой оттуда.",
  denied: "Уведомления запрещены. Включи их в настройках телефона: «Настройки» → «Уведомления» → Raspison.",
  off: "Домашка, новости, анонимные вопросы и опросы будут приходить на телефон.",
  on: "Приходят на это устройство.",
};

/** VAPID-ключ из base64url в байты — так его ждёт pushManager.subscribe. */
function vapidKeyToBytes(key: string): Uint8Array {
  const base64 = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Наши собственные понятные ошибки; всё остальное (DOMException браузера по-английски) человеку показывать нечего. */
class PushError extends Error {}

/** Список с одной переключённой темой; порядок всегда как в PUSH_TOPICS, повторов не бывает. */
const withTopic = (list: readonly PushTopic[], topic: PushTopic, on: boolean): PushTopic[] =>
  on ? PUSH_TOPICS.filter((t) => t === topic || list.includes(t)) : list.filter((t) => t !== topic);

/**
 * Ни один шаг подписки не должен висеть бесконечно: и регистрация service worker, и обращение к службе
 * уведомлений Apple/Google уходят в сеть, а в универе она бывает никакая. Лучше честное «попробуй позже»,
 * чем вечно серый тумблер. Если подписка всё-таки доедет позже, её подхватит сверка при следующем заходе в Профиль.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new PushError(message)), ms))]);
}

export function PushSwitch({ vapidPublicKey, topics: initialTopics }: { vapidPublicKey: string; topics: PushTopic[] }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [topics, setTopics] = useState<PushTopic[]>(initialTopics);
  // Зеркало списка тем: обработчику нужен актуальный список синхронно, сразу в тапе. Два быстрых тапа
  // по разным темам случаются раньше, чем React перерисует строки, и снимок из замыкания второму уже врал бы.
  const topicsRef = useRef<PushTopic[]>(initialTopics);
  const toast = useToast();
  // Строкой, а не массивом: у пропа-массива каждый рендер новая ссылка, и эффект уходил бы в круг.
  const topicsKey = initialTopics.join(",");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const found = await detectState(vapidPublicKey);
      if (!alive) return;
      setState(found.state);
      // Подписка в браузере есть, а в базе могла пропасть (чистка мёртвых, другой профиль на этом же телефоне) —
      // тихо записываем её заново, иначе тумблер обещает уведомления, которых никто не пришлёт.
      if (found.subscription) {
        const keys = found.subscription.toJSON().keys;
        if (keys?.p256dh && keys.auth) {
          // Пустая строка от split даёт [""], а не пустой список, — а «тем нет» здесь значимо: так сервер
          // узнаёт, что человек снял все галочки, и не подставит запас по умолчанию.
          const known = topicsKey ? topicsKey.split(",") : [];
          void savePushSubscription({ endpoint: found.subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth, topics: known }).catch(() => {});
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [topicsKey, vapidPublicKey]);

  const enable = useCallback(async () => {
    // requestPermission вызываем первым делом: Safari засчитывает жест только в самом обработчике тапа.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission === "denied" ? "denied" : "off");
      return;
    }
    setBusy(true);
    try {
      const reg = await withTimeout(navigator.serviceWorker.ready, 12_000, "Приложение ещё не готово, попробуй ещё раз");
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await withTimeout(
          reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyToBytes(vapidPublicKey) as BufferSource }),
          20_000,
          "Служба уведомлений не ответила. Попробуй позже.",
        ));
      const keys = sub.toJSON().keys;
      if (!keys?.p256dh || !keys.auth) throw new PushError("Браузер не выдал ключи подписки");
      const res = await savePushSubscription({ endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth, topics });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        toast(res.error);
        setState("off");
        return;
      }
      setState("on");
    } catch (e) {
      console.warn("[push] подписка не удалась:", e);
      toast(e instanceof PushError ? e.message : "Не получилось включить уведомления — браузер отказал");
      setState("off");
    } finally {
      setBusy(false);
    }
  }, [toast, topics, vapidPublicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    setState("off");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        const res = await removePushSubscription(endpoint);
        if (!res.ok) toast(res.error);
      }
    } catch {
      toast("Не сохранилось — нет сети");
    } finally {
      setBusy(false);
    }
  }, [toast]);

  /** Переключить одну тему и там же получить актуальный список для отправки. */
  const applyTopic = useCallback((topic: PushTopic, on: boolean) => {
    const next = withTopic(topicsRef.current, topic, on);
    topicsRef.current = next;
    setTopics(next);
    return next;
  }, []);

  const changeTopics = useCallback(
    async (topic: PushTopic, on: boolean) => {
      const res = await setPushTopics(applyTopic(topic, on)).catch(() => null);
      if (!res || !res.ok) {
        // Откатываем ровно одну тему, а не весь снимок: пока этот запрос летел, соседнюю галочку могли
        // успешно сохранить выключенной, и возврат снимка вернул бы её в UI включённой вопреки базе.
        applyTopic(topic, !on);
        toast(res ? res.error : "Не сохранилось — нет сети");
      }
    },
    [applyTopic, toast],
  );

  const locked = state === "checking" || state === "unconfigured" || state === "unsupported" || state === "install" || state === "denied";
  // Подписка жива, но все темы сняты — тумблер честно включён, а вот «приходят на это устройство» было бы враньём:
  // не придёт ничего. Сам тумблер не выключаем, иначе одна снятая галочка обратно потянула бы за собой подписку.
  const allTopicsOff = state === "on" && topics.length === 0;

  return (
    <div className="space-y-2">
      <SwitchRow
        checked={state === "on"}
        disabled={locked || busy}
        onChange={(next) => void (next ? enable() : disable())}
        label="Уведомления"
        hint={allTopicsOff ? "Все темы выключены — ничего не придёт." : HINTS[state]}
      />
      {state === "on" && (
        <div className="space-y-2 pl-3">
          <div className="px-1 text-[12px] font-semibold uppercase tracking-wide text-dim">Что присылать</div>
          {PUSH_TOPICS.map((t) => (
            <SwitchRow
              key={t}
              checked={topics.includes(t)}
              disabled={busy}
              onChange={(on) => void changeTopics(t, on)}
              label={TOPIC_LABELS[t]}
              className="bg-surface-2"
            />
          ))}
        </div>
      )}
    </div>
  );
}

async function detectState(vapidPublicKey: string): Promise<{ state: State; subscription?: PushSubscription }> {
  try {
    if (!vapidPublicKey) return { state: "unconfigured" };
    // iOS без установки: PushManager там просто отсутствует, и «не поддерживается» было бы неправдой — поддерживается, но после установки.
    if (isIos() && !isStandalone()) return { state: "install" };
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { state: "unsupported" };
    if (Notification.permission === "denied") return { state: "denied" };
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub ? { state: "on", subscription: sub } : { state: "off" };
  } catch {
    return { state: "unsupported" };
  }
}
