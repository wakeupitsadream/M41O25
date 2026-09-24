import type { ChatAttachment } from "@/lib/assistant/types";

/*
 * Загрузка вложения для чата через общий POST /api/upload с entityType "assistant" (docs/AI-CHAT.md §5).
 * Сжатие фото — те же параметры, что у AttachmentUploader для домашки: ~1.5 МБ и 2200 px хватает, чтобы модель
 * прочитала конспект, и тело запроса остаётся под лимитом Vercel. Своя функция, а не AttachmentUploader:
 * у того крупные плитки и подпись, которые в композер чата не помещаются.
 */

export const MAX_FILES = 4;
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Как у AttachmentUploader. HEIC в списке нет намеренно: тогда iOS сама отдаёт фото из галереи как JPEG.
 * Старые бинарные DOC/XLS/PPT пускаем: сервер честно ответит, что их надо пересохранить (§5), а не молча отфильтрует.
 */
export const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";

export type Uploaded = ChatAttachment & { size: number };

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export async function uploadForAssistant(original: File): Promise<Uploaded> {
  let file = original;
  if (file.type.startsWith("image/") && file.type !== "image/gif") {
    const { default: compress } = await import("browser-image-compression");
    const blob = await compress(file, { maxSizeMB: 1.5, maxWidthOrHeight: 2200, initialQuality: 0.85, useWebWorker: true, fileType: "image/jpeg" });
    file = new File([blob], file.name.replace(/\.(heic|heif|png|webp)$/i, ".jpg"), { type: "image/jpeg" });
  }
  if (file.size > MAX_BYTES) throw new UploadError(`«${original.name}» больше 4 МБ — сожми или пришли фото страниц`);
  const fd = new FormData();
  fd.set("file", file);
  fd.set("entityType", "assistant");
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  // Vercel может ответить не-JSON (413 до нашего кода) — не падаем на res.json().
  const json = res.headers.get("content-type")?.includes("application/json") ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
  if (!res.ok) {
    const msg = typeof json?.error === "string" ? json.error : res.status === 413 ? "Файл слишком большой (до 4 МБ)" : `Не загрузилось (${res.status})`;
    throw new UploadError(msg, res.status);
  }
  if (!json || typeof json.id !== "string" || typeof json.url !== "string") throw new UploadError("Сервер не вернул файл — попробуй ещё раз");
  return {
    id: json.id,
    url: json.url,
    name: typeof json.name === "string" ? json.name : file.name,
    mime: typeof json.mime === "string" ? json.mime : file.type,
    size: typeof json.size === "number" ? json.size : file.size,
  };
}
