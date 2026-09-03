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
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = asUuid((await params).id);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const user = await getSessionUser();
  const viaToken = !user && verifyScoped(`file:${id}`, new URL(req.url).searchParams.get("t"));
  if (!user && !viaToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [att] = await db
    .select()
    .from(attachments)
    .where(user ? and(eq(attachments.id, id), eq(attachments.groupId, user.groupId)) : eq(attachments.id, id));
  if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (att.entityType === "scan" && user?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
