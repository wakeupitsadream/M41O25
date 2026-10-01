import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { asUuid } from "@/lib/utils";
import { verifyScoped } from "@/lib/files/token";

export const runtime = "nodejs";

/**
 * Прокси-отдача файла: клиент видит только наш домен, R2/Cloudflare остаётся за сервером.
 * Без cookie файл отдаётся по подписанному токену ?t= (внешний браузер из установленного PWA); сканы — только админу с cookie.
 * Вложения помощника — личные: только автору со своей сессии, по токену без cookie не отдаются вовсе, и админу тоже
 * (в интерфейсе ему такой доступ не нужен, а студенту обещано, что беседы видит только он).
 *
 * Порядок проверок: сначала токен — он проверяется без базы, а в приложении почти все картинки идут с токеном
 * (fileHref), так что сессию для них читать незачем: это минус один запрос к базе на каждое фото.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = asUuid((await params).id);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const viaToken = verifyScoped(`file:${id}`, new URL(req.url).searchParams.get("t"));
  const user = viaToken ? null : await getSessionUser();
  if (!user && !viaToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [att] = await db
    .select()
    .from(attachments)
    .where(user ? and(eq(attachments.id, id), eq(attachments.groupId, user.groupId)) : eq(attachments.id, id));
  if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (att.entityType === "scan") {
    // Скан — внутренний документ вуза: только админ и только с cookie; токен (даже свой) здесь не годится.
    const admin = user ?? (await getSessionUser());
    if (admin?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (att.entityType === "assistant") {
    // Одногруппник, узнавший uuid, не должен открыть чужое фото из чата; подписанная ссылка без cookie для этого типа тоже
    // не годится — по ней чужой чат открылся бы в любом браузере. Поэтому только живая сессия владельца.
    const owner = user ?? (await getSessionUser());
    if (!owner || att.uploadedBy !== owner.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const obj = await storage.get(att.fileKey);
  if (!obj) return NextResponse.json({ error: "file missing" }, { status: 404 });

  const inline = att.mime.startsWith("image/") || att.mime === "application/pdf";
  return new NextResponse(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": att.mime,
      "Content-Length": String(obj.body.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
