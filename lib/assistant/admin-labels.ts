import type { AccessStatus } from "./types";

/*
 * Подписи доступа к помощнику для админки: строка в карточке человека и бейдж в списке людей. Чистые функции
 * от AccessStatus (accessStatus из access.ts) и сегодняшней даты — без server-only, под node:test.
 */

/**
 * «24.10» — как в спецификации; год дописываем, только если он не текущий: ручная дата «оплачено до» может уехать
 * в следующий январь, и «до 15.01» тогда читалась бы как уже прошедшая.
 */
export function fmtUntil(iso: string, today: string): string {
  const dm = `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? dm : `${dm}.${iso.slice(2, 4)}`;
}

/** Строка состояния в карточке человека (docs/AI-CHAT.md §9). */
export function accessLine(status: AccessStatus, today: string): string {
  switch (status.kind) {
    case "none":
      return "не начинал";
    case "trial":
      return `пробный до ${fmtUntil(status.until, today)}`;
    case "paid":
      return `оплачено до ${fmtUntil(status.until, today)}`;
    case "expired":
      return status.since ? `не оплачено (истекло ${fmtUntil(status.since, today)})` : "не оплачено";
  }
}

export type AccessBadge = { tone: "ok" | "neutral"; text: string };

/**
 * Бейдж в списке людей — только при живом доступе: оплата зелёная («ИИ до 24.10»), пробная неделя нейтральная
 * и подписана словом, а не только цветом: по списку админ видит, кому скоро напомнить про оплату.
 */
export function accessBadge(status: AccessStatus, today: string): AccessBadge | null {
  if (status.kind === "paid") return { tone: "ok", text: `ИИ до ${fmtUntil(status.until, today)}` };
  if (status.kind === "trial") return { tone: "neutral", text: `ИИ проба до ${fmtUntil(status.until, today)}` };
  return null;
}
