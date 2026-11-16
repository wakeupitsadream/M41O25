import type { Button, CallbackButton, KeyboardAttachment } from "./types.js";

/** Callback-кнопка. Payload держим коротким (< 64 байт): лимит MAX не задокументирован, у Telegram он 64. */
export const cb = (text: string, payload: string): CallbackButton => ({ type: "callback", text, payload });

export const keyboard = (rows: Button[][]): KeyboardAttachment => ({
  type: "inline_keyboard",
  payload: { buttons: rows.filter((r) => r.length > 0) },
});

/** Раскладывает кнопки по рядам заданной ширины. */
export function grid<T>(items: T[], width: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += width) rows.push(items.slice(i, i + width));
  return rows;
}
