import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceSessions, groups, users, type Group, type Role, type User } from "@/lib/db/schema";

export const SESSION_COOKIE = "raspison_session";
export const INVITE_COOKIE = "raspison_invite";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

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

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

const INVITE_MAX_AGE = 60 * 15;

const inviteSig = (groupId: string) =>
  createHash("sha256").update(`${groupId}:${process.env.AUTH_SECRET ?? ""}`).digest("base64url").slice(0, 32);

/** Инвайт-код проверен → на 15 минут запоминаем группу в подписанной cookie (шаг «выбери себя»). */
export async function setInviteCookie(groupId: string) {
  (await cookies()).set(INVITE_COOKIE, `${groupId}.${inviteSig(groupId)}`, cookieOptions(INVITE_MAX_AGE));
}

export async function readInviteGroupId(): Promise<string | null> {
  const raw = (await cookies()).get(INVITE_COOKIE)?.value;
  if (!raw) return null;
  const [groupId, sig] = raw.split(".");
  if (!groupId || !sig) return null;
  const expected = inviteSig(groupId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? groupId : null;
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
  if (!user) throw new Error("Сессия не найдена — войди заново");
  if (!hasRole(user, min)) throw new Error("Недостаточно прав");
  return user;
}
