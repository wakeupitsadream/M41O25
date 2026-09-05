import { fail, type ActionResult } from "@/lib/utils";

/**
 * Обёртка тела server action: любое исключение (база, лимит, сеть) превращается в fail(...),
 * чтобы клиент получил ActionResult, а не 500. Ошибки валидации внутри fn возвращаются как fail сами.
 * redirect() бросает NEXT_REDIRECT — вызывать его после wrapAction, а не внутри.
 */
export const wrapAction = async <T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Что-то пошло не так");
  }
};
