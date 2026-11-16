import { randomBytes } from "node:crypto";

/** Короткий id для callback-payload: 10 символов base36 (~51 бит). */
export function shortId(): string {
  let out = "";
  for (const b of randomBytes(10)) out += (b % 36).toString(36);
  return out;
}
