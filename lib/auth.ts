import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceSessions, groups, users, type Group, type Role, type User } from "@/lib/db/schema";
import { SESSION_COOKIE, SESSION_MAX_AGE, cookieOptions } from "@/lib/session-cookie";
import { signScoped, verifyScoped } from "@/lib/files/token";
import { normalizeInviteCode } from "@/lib/invite";
import { ActionError } from "@/lib/actions";
import { WRONG_PIN, lockMessage, lockMinutesForFailures } from "@/lib/auth-lock";
import { asUuid } from "@/lib/utils";

export const INVITE_COOKIE = "raspison_invite";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const hashPin = (pin: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
};

export const verifyPin = (pin: string, stored: string) => {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

const INVITE_MAX_AGE = 60 * 15;

/**
 * Инвайт-код проверен → на 15 минут запоминаем группу в подписанной cookie (шаг «выбери себя»).
 * Подпись — HMAC со сроком и хешем самого кода (lib/files/token.ts): скопированное значение cookie не живёт дольше
 * 15 минут на сервере, а «Сменить код» в админке обесценивает и уже выданные cookie — раньше подпись зависела
 * только от id группы и была бессрочным эквивалентом знания кода.
 */
const inviteScope = (groupId: string, inviteCode: string) => `invite:${groupId}:${hashToken(normalizeInviteCode(inviteCode)).slice(0, 32)}`;

export async function setInviteCookie(groupId: string, inviteCode: string) {
  (await cookies()).set(INVITE_COOKIE, `${groupId}.${signScoped(inviteScope(groupId, inviteCode), INVITE_MAX_AGE * 1000)}`, cookieOptions(INVITE_MAX_AGE));
}

/** Группа из инвайт-cookie, если подпись верна для её ТЕКУЩЕГО кода и срок не вышел; иначе null. Один запрос к базе. */
export async function readInviteGroupId(): Promise<string | null> {
  const raw = (await cookies()).get(INVITE_COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot < 0) return null;
  const groupId = asUuid(raw.slice(0, dot));
  const token = raw.slice(dot + 1);
  if (!groupId || !token) return null;
  const [group] = await db.select({ inviteCode: groups.inviteCode }).from(groups).where(eq(groups.id, groupId));
  if (!group) return null;
  return verifyScoped(inviteScope(groupId, group.inviteCode), token) ? groupId : null;
}

export async function clearInviteCookie() {
  (await cookies()).delete(INVITE_COOKIE);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db.insert(deviceSessions).values({ userId, tokenHash: hashToken(token), userAgent: ua });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE));
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db
      .update(deviceSessions)
      .set({ revokedAt: new Date() })
      .where(eq(deviceSessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Неверный PIN (вход или смена PIN): счётчик растёт прямо в базе (`pin_failed_count + 1 … returning`), и блокировка
 * ставится по возвращённому значению. Читать-прибавлять-писать в JS нельзя: N одновременных запросов читали бы одно
 * число и писали бы одно и то же +1 — замок на пятой попытке так и не наступал. Условие на `pin_locked_until`
 * не даёт двум параллельным пятым попыткам продлить срок дважды. Возвращает текст для человека.
 */
export async function registerPinFailure(userId: string): Promise<string> {
  const [row] = await db
    .update(users)
    .set({ pinFailedCount: sql`${users.pinFailedCount} + 1` })
    .where(eq(users.id, userId))
    .returning({ failed: users.pinFailedCount });
  const minutes = lockMinutesForFailures(row?.failed ?? 1);
  if (minutes === null) return WRONG_PIN;
  const until = new Date(Date.now() + minutes * 60_000);
  await db
    .update(users)
    .set({ pinLockedUntil: until })
    .where(and(eq(users.id, userId), sql`(${users.pinLockedUntil} is null or ${users.pinLockedUntil} < ${until.toISOString()}::timestamptz)`));
  return lockMessage(minutes);
}

export type SessionUser = User & { group: Group; sessionId: string };

/** Текущий пользователь по cookie устройства; кешируется на время запроса. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ session: deviceSessions, user: users, group: groups })
    .from(deviceSessions)
    .innerJoin(users, eq(users.id, deviceSessions.userId))
    .innerJoin(groups, eq(groups.id, users.groupId))
    .where(
      and(
        eq(deviceSessions.tokenHash, hashToken(token)),
        isNull(deviceSessions.revokedAt),
        gt(deviceSessions.createdAt, new Date(Date.now() - SESSION_MAX_AGE * 1000)),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Отметки «был онлайн» — не чаще раза в 10 минут, чтобы не писать в БД на каждый запрос.
  const stale = !row.user.lastSeenAt || Date.now() - row.user.lastSeenAt.getTime() > 10 * 60_000;
  if (stale) {
    // after(): на serverless «выстрелил и забыл» может не выполниться до заморозки функции.
    after(async () => {
      const now = new Date();
      await Promise.all([
        db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user.id)),
        db.update(deviceSessions).set({ lastUsedAt: now }).where(eq(deviceSessions.id, row.session.id)),
      ]).catch(() => {});
    });
  }
  return { ...row.user, group: row.group, sessionId: row.session.id };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect((await cookies()).get(SESSION_COOKIE) ? "/api/auth/clear" : "/enter");
  return user;
}

const ROLE_RANK: Record<Role, number> = { student: 0, moderator: 1, admin: 2 };

export const hasRole = (user: { role: Role }, min: Role) => ROLE_RANK[user.role] >= ROLE_RANK[min];

export async function requireRole(min: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user, min)) redirect("/");
  return user;
}

/** Для server actions: возвращает пользователя или бросает понятную ошибку (без redirect внутри action). */
export async function actionUser(min: Role = "student"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ActionError("Сессия не найдена — войди заново");
  if (!hasRole(user, min)) throw new ActionError("Недостаточно прав");
  return user;
}
