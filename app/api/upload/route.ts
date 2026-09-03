import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, storage } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const ENTITY = new Set(["homework", "news", "task", "scan"]);

/** Загрузка одного файла (multipart). Возвращает id вложения; привязка к сущности — при создании записи. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const entityType = String(form?.get("entityType") ?? "homework");
  if (!(file instanceof File)) return NextResponse.json({ error: "Файл не получен" }, { status: 400 });
  if (!ENTITY.has(entityType)) return NextResponse.json({ error: "Неизвестный тип" }, { status: 400 });
  if (entityType === "scan" && user.role !== "admin") return NextResponse.json({ error: "Только админ" }, { status: 403 });
  if (entityType === "scan" && !file.type.startsWith("image/")) return NextResponse.json({ error: "Скан должен быть фото или картинкой (JPEG/PNG). PDF пересними или сконвертируй" }, { status: 415 });
  if ((entityType === "news" || entityType === "task") && user.role === "student") return NextResponse.json({ error: "Вложения к новостям и задачам добавляет староста" }, { status: 403 });

  // Квота для студентов: не больше 30 файлов в час и 40 МБ в сутки — от залива хранилища «сиротами».
  if (user.role === "student") {
    const [{ hourCount }] = await db
      .select({ hourCount: count() })
      .from(attachments)
      .where(and(eq(attachments.uploadedBy, user.id), gt(attachments.createdAt, new Date(Date.now() - 3600_000))));
    const [{ dayBytes }] = await db
      .select({ dayBytes: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)`.mapWith(Number) })
      .from(attachments)
      .where(and(eq(attachments.uploadedBy, user.id), gt(attachments.createdAt, new Date(Date.now() - 86_400_000))));
    if (hourCount >= 30 || dayBytes >= 40 * 1024 * 1024) return NextResponse.json({ error: "Лимит загрузок на сегодня исчерпан — попробуй позже" }, { status: 429 });
  }
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Файл больше 4 МБ. Сожми фото или пришли ссылку на файл." }, { status: 413 });

  const ext = ALLOWED_MIME[file.type];
  if (!ext) return NextResponse.json({ error: "Такой формат не поддерживается (фото, PDF, Word, Excel, PowerPoint, txt)" }, { status: 415 });

  const buf = Buffer.from(await file.arrayBuffer());
  const month = new Date().toISOString().slice(0, 7);
  const key = `${user.groupId}/${entityType}/${month}/${randomUUID()}.${ext}`;
  await storage.put(key, buf, file.type);

  const [row] = await db
    .insert(attachments)
    .values({
      groupId: user.groupId,
      entityType: entityType as "homework" | "news" | "task" | "scan",
      fileKey: key,
      fileName: file.name.slice(0, 200) || `file.${ext}`,
      mime: file.type,
      sizeBytes: file.size,
      uploadedBy: user.id,
    })
    .returning({ id: attachments.id });

  return NextResponse.json({ id: row.id, url: `/api/files/${row.id}`, name: file.name, mime: file.type, size: file.size });
}
