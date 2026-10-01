import { unstable_rethrow } from "next/navigation";
import type { FormState } from "@/lib/form";
import { fail, type ActionResult } from "@/lib/utils";

/**
 * Ошибка, текст которой можно показать человеку как есть: «Сессия не найдена», «Недостаточно прав», лимит действий.
 * Всё остальное, что вылетает из тела действия (Postgres, сеть, баг), — чужие ошибки: их текст уходит в журнал,
 * а человеку достаётся общая фраза. Раньше wrapAction отдавал в тост любое сообщение, включая
 * «invalid input syntax for type uuid».
 */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

const GENERIC = "Что-то пошло не так — попробуй ещё раз";

/** Чужую ошибку пишем в app_errors (ленивый импорт: lib/db не должен тянуться в клиентский бандл через этот модуль). */
async function report(e: unknown) {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error("[action]", message);
  try {
    const { logAppError } = await import("@/lib/errors");
    await logAppError({ route: "server action", message, digest: null, kind: "action" });
  } catch {}
}

/**
 * Обёртка тела server action: исключение превращается в fail(...), чтобы клиент получил ActionResult, а не 500.
 * Ошибки валидации внутри fn возвращаются как fail сами. redirect()/notFound() пробрасываются дальше —
 * это не ошибки, а управление потоком Next; поэтому редирект можно вызывать и внутри обёртки.
 */
export const wrapAction = async <T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ActionError) return fail(e.message);
    await report(e);
    return fail(GENERIC);
  }
};

/** То же для действий форм (useActionState/ActionForm): ошибка — под полями, введённое не теряется. */
export const wrapForm = async (fn: () => Promise<FormState>): Promise<FormState> => {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ActionError) return { error: e.message };
    await report(e);
    return { error: GENERIC };
  }
};
