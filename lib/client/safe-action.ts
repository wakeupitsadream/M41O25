import { isOfflineError } from "@/lib/hw/draft";

export const OFFLINE_MESSAGE = "Не сохранилось — нет сети";
export const FAILED_MESSAGE = "Не получилось — попробуй ещё раз";

/** navigator.onLine врёт только в сторону «сеть есть»; на сервере и в старых браузерах тоже считаем, что сеть есть. */
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;

/**
 * Вызов server action из клиентского компонента, переживающий отсутствие сети.
 *
 * Без сети action падает не ActionResult, а исключением fetch («Load failed» в Safari, «Failed to fetch» в Chrome),
 * и в React 19 исключение из async-функции внутри startTransition летит в ближайший Error Boundary: весь экран
 * сменился бы на «Нет сети», а набранный текст и позиция скролла пропали бы (ревью UI-01). Здесь исключение ловится,
 * человеку показывается короткое сообщение через onError (обычно это тост), а вызывающий получает null и просто
 * выходит — оптимистичное состояние откатится само по завершении transition. Чистая функция без React: тест рядом.
 */
export async function safeAction<T>(fn: () => Promise<T>, onError: (message: string) => void): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    const offline = isOfflineError(e, online());
    // Не сеть, а что-то неожиданное — пусть будет видно в консоли, иначе ошибка исчезнет за общим текстом тоста.
    if (!offline) console.error(e);
    onError(offline ? OFFLINE_MESSAGE : FAILED_MESSAGE);
    return null;
  }
}
