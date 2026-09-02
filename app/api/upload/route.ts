import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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
