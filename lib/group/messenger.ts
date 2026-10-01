/*
 * Поле «Мессенджер» у контакта — свободный текст старосты: «@ivanov», «t.me/ivanov», «https://vk.com/id1»,
 * «ВК / Telegram @ivanov». Где адрес однозначен, делаем из него ссылку (https://t.me/…, https://vk.com/…):
 * Telegram и ВК перехватывают её своим приложением, cookie не нужна. Остальное остаётся текстом для копирования.
 */

export type MessengerLink = { href: string | null; label: string };

/** Ник Telegram: латиница, цифры и подчёркивание, 5–32 символа. */
const TG_NICK = /^[a-z0-9_]{5,32}$/i;
const TG_HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);
const VK_HOSTS = new Set(["vk.com", "vk.ru", "m.vk.com", "vk.me"]);

/** Один токен текста → https-ссылка или null. Хвостовую пунктуацию («t.me/ivanov.») не считаем частью адреса. */
function tokenHref(token: string, ambiguousAt: boolean): string | null {
  const t = token.replace(/[.,;:!?)»]+$/, "");
  if (t.startsWith("@")) {
    const nick = t.slice(1);
    return !ambiguousAt && TG_NICK.test(nick) ? `https://t.me/${nick}` : null;
  }
  const m = /^(?:https?:\/\/)?(?:www\.)?([a-z.]+)\/([^\s/][^\s]*)$/i.exec(t);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const path = m[2].replace(/\/+$/, "");
  if (!path) return null;
  if (TG_HOSTS.has(host)) return `https://t.me/${path}`;
  if (VK_HOSTS.has(host)) return `https://${host === "vk.me" ? "vk.me" : "vk.com"}/${path}`;
  return null;
}

export function messengerLink(raw: string): MessengerLink {
  const label = raw.trim();
  const lower = label.toLowerCase();
  // «ВК @ivanov»: голый @ник рядом с ВК и без упоминания Telegram — куда вести, неясно, оставляем текстом.
  const mentionsVk = ["vk", "вк", "вконтакте"].some((w) => lower.includes(w));
  const mentionsTg = ["tg", "тг", "telegram", "телеграм", "t.me"].some((w) => lower.includes(w));
  const ambiguousAt = mentionsVk && !mentionsTg;
  for (const token of label.split(/\s+/)) {
    const href = tokenHref(token, ambiguousAt);
    if (href) return { href, label };
  }
  return { href: null, label };
}
