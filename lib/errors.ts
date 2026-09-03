import { db } from "@/lib/db";
import { appErrors } from "@/lib/db/schema";

/** Запись ошибки в базу; сама никогда не бросает — иначе ошибка в логгере спрятала бы исходную. */
export async function logAppError(e: { route: string | null; message: string; digest: string | null; kind: string | null }) {
  try {
    await db.insert(appErrors).values({ route: e.route?.slice(0, 200) ?? null, message: e.message.slice(0, 2000), digest: e.digest, kind: e.kind });
  } catch (err) {
    console.error("[errors] не удалось записать ошибку:", err instanceof Error ? err.message : err);
  }
}
