/**
 * Инвайт-код группы. Студент вводит его с телефона, часто с русской раскладки: «М41» вместо «M41»,
 * без дефиса, с пробелами. Приводим и ввод, и сохранённый код к одному канону и сравниваем каноны.
 */
const HOMOGLYPHS: Record<string, string> = {
  А: "A", В: "B", С: "C", Е: "E", Н: "H", К: "K", М: "M", О: "O", Р: "P", Т: "T", Х: "X", У: "Y", З: "3",
};

/** Канон кода: верхний регистр, кириллические двойники → латиница, остаются только A–Z и 0–9. */
export function normalizeInviteCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[АВСЕНКМОРТХУЗ]/g, (ch) => HOMOGLYPHS[ch] ?? ch)
    .replace(/[^A-Z0-9]/g, "");
}

/** Латинский префикс кода из названия группы: «М41О25» → «M41». Код всегда набирается латиницей. */
export function invitePrefix(shortName: string): string {
  const latin = normalizeInviteCode(shortName);
  return (latin || "GRP").slice(0, 3);
}

export const inviteCodesMatch = (stored: string, typed: string) => normalizeInviteCode(stored) === normalizeInviteCode(typed);
