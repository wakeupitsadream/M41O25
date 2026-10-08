import { errorText, log } from "../log.js";
import { courseNumber } from "../util/time.js";
import type { Deps } from "./deps.js";

export type RaspisonProfile = {
  group?: { name?: string; shortName?: string } | null;
  subjects?: Array<{ name: string; shortName?: string | null }>;
};

type Cached = { fetchedAt: string; data: RaspisonProfile };

const REFRESH_MS = 12 * 3_600_000;

/** Предметы группы из Raspison (GET /api/bot/profile). Кэш на 12 часов; при сбое — последний удачный ответ. */
export async function raspisonProfile(deps: Deps, force = false): Promise<RaspisonProfile | null> {
  const conn = deps.config.raspison;
  if (!conn) return null;
  const cached = await deps.store.getState<Cached>("raspison_profile");
  const fresh = cached && deps.now().getTime() - Date.parse(cached.fetchedAt) < REFRESH_MS;
  if (fresh && !force) return cached.data;
  try {
    const query = conn.group ? `?group=${encodeURIComponent(conn.group)}` : "";
    const res = await deps.fetch(`${conn.url}/api/bot/profile${query}`, {
      headers: { authorization: `Bearer ${conn.key}` },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RaspisonProfile;
    const subjects = Array.isArray(data.subjects)
      ? data.subjects.filter((s) => s && typeof s.name === "string").map((s) => ({ name: s.name, shortName: s.shortName ?? null }))
      : [];
    const clean: RaspisonProfile = { group: data.group ?? null, subjects };
    await deps.store.setState("raspison_profile", { fetchedAt: deps.now().toISOString(), data: clean } satisfies Cached);
    return clean;
  } catch (err) {
    log("warn", "raspison_profile_failed", { error: errorText(err) });
    return cached?.data ?? null;
  }
}

export function defaultAbout(deps: Deps): string {
  const course = courseNumber(deps.now(), deps.config.studyStartYear, deps.config.tz);
  return `студент ${course} курса РАНХиГС (Оренбургский филиал), направление «Менеджмент», профиль «Управление бизнесом»`;
}

/** Строка «о студенте» для системного промпта. */
export async function profileForPrompt(deps: Deps): Promise<string> {
  const about = (await deps.store.getState<string>("profile_about"))?.trim() || defaultAbout(deps);
  const rasp = await raspisonProfile(deps).catch(() => null);
  const subjects = (rasp?.subjects ?? []).map((s) => s.name).slice(0, 25);
  const group = rasp?.group?.shortName ? `, группа ${rasp.group.shortName}` : "";
  return subjects.length ? `${about}${group}. Предметы семестра: ${subjects.join(", ")}.` : `${about}${group}.`;
}
