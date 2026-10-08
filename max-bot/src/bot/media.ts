import type { MediaRef } from "../db/store.js";
import type { Part } from "../llm/types.js";
import { errorText, log } from "../log.js";
import { looksLikeImageName, sniffAudio, sniffImage } from "../max/media.js";
import type { MessageBody } from "../max/types.js";
import type { Deps } from "./deps.js";

export const MAX_IMAGES = 6;
const IMAGE_BYTES = 15 * 1024 * 1024;
const AUDIO_BYTES = 25 * 1024 * 1024;

export type Extracted = { images: MediaRef[]; audio: MediaRef[]; other: Array<"video" | "file" | "sticker" | "other"> };

/** Вложения сообщения MAX → что скачать и что отклонить. Клавиатуры (наши же кнопки) пропускаем. */
export function mediaOf(body: MessageBody | null | undefined, ownMid?: string): Extracted {
  const out: Extracted = { images: [], audio: [], other: [] };
  if (!body) return out;
  // У пересланного вложения свой mid из чужого чата: отвечать (link reply) можно только на сообщение этого чата.
  const mid = ownMid ?? body.mid;
  for (const att of body.attachments ?? []) {
    const url = (att.payload as { url?: string | null } | undefined)?.url ?? null;
    switch (att.type) {
      case "image":
        if (url) out.images.push({ kind: "image", url, mid });
        break;
      case "file":
        if (url && looksLikeImageName(att.filename)) out.images.push({ kind: "image", url, mid, name: att.filename });
        else out.other.push("file");
        break;
      case "audio":
        if (url) out.audio.push({ kind: "audio", url, mid });
        break;
      case "video":
        out.other.push("video");
        break;
      case "sticker":
        out.other.push("sticker");
        break;
      case "inline_keyboard":
        break;
      default:
        out.other.push("other");
    }
  }
  return out;
}

/** Скачивает фото (до MAX_IMAGES штук) параллельно; битые и не-картинки пропускает. */
export async function loadImages(deps: Deps, refs: MediaRef[]): Promise<{ parts: Part[]; failed: number; dropped: number }> {
  const take = refs.slice(0, MAX_IMAGES);
  const results = await Promise.allSettled(take.map((r) => deps.max.download(r.url, IMAGE_BYTES)));
  const parts: Part[] = [];
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failed++;
      log("warn", "image_download_failed", { error: errorText(r.reason), host: new URL(take[i]!.url).hostname });
      return;
    }
    const ct = r.value.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
    const mime = sniffImage(r.value.data) ?? (ct.startsWith("image/") ? ct : null);
    if (!mime) {
      failed++;
      return;
    }
    parts.push({ type: "image", mime: mime === "image/jpg" ? "image/jpeg" : mime, data: r.value.data });
  });
  return { parts, failed, dropped: Math.max(0, refs.length - MAX_IMAGES) };
}

export async function loadAudio(deps: Deps, ref: MediaRef): Promise<{ data: Buffer; mime: string }> {
  const file = await deps.max.download(ref.url, AUDIO_BYTES);
  const ct = file.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const mime = sniffAudio(file.data) ?? (ct.startsWith("audio/") ? (ct === "audio/x-m4a" ? "audio/mp4" : ct) : "audio/ogg");
  return { data: file.data, mime: mime === "audio/mp3" ? "audio/mpeg" : mime };
}
