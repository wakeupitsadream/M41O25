"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, ImagePlus, Loader2, X } from "lucide-react";
import { fmtBytes } from "@/lib/hw/format";
import { cn } from "@/lib/utils";

export type UploadedFile = { id: string; name: string; mime: string; size: number; url: string };

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";

/** Загрузка вложений: фото сжимаются на клиенте до ~1.5 МБ (лимит тела запроса на Vercel — 4.5 МБ). */
const MAX_BYTES = 4 * 1024 * 1024;

export function AttachmentUploader({
  entityType = "homework",
  value,
  onChange,
  max = 6,
  accept = ACCEPT,
}: {
  entityType?: "homework" | "news" | "task" | "scan";
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  max?: number;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Актуальное значение для параллельных загрузок — иначе вторая пачка затирает первую устаревшим замыканием.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const push = (files: UploadedFile[]) => {
    latest.current = [...latest.current, ...files];
    onChange(latest.current);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files).slice(0, Math.max(0, max - latest.current.length));
    setBusy((b) => b + list.length);
    for (const original of list) {
      try {
        let file = original;
        if (file.type.startsWith("image/") && file.type !== "image/gif") {
          const { default: compress } = await import("browser-image-compression");
          // Скан со всеми группами: столбец нашей группы узкий, при 2200 px буквы становятся нечитаемыми. Держимся под лимитом тела 4 МБ.
          const preset = entityType === "scan" ? { maxSizeMB: 3.6, maxWidthOrHeight: 3600, initialQuality: 0.92 } : { maxSizeMB: 1.5, maxWidthOrHeight: 2200, initialQuality: 0.85 };
          const blob = await compress(file, { ...preset, useWebWorker: true, fileType: "image/jpeg" });
          file = new File([blob], file.name.replace(/\.(heic|heif|png|webp)$/i, ".jpg"), { type: "image/jpeg" });
        }
        if (file.size > MAX_BYTES) throw new Error(`«${original.name}» больше 4 МБ — сожми или пришли ссылкой`);
        const fd = new FormData();
        fd.set("file", file);
        fd.set("entityType", entityType);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        // Vercel может ответить не-JSON (413 до нашего кода) — не падаем на res.json().
        const isJson = res.headers.get("content-type")?.includes("application/json");
        const json = isJson ? await res.json() : null;
        if (!res.ok) throw new Error(json?.error ?? (res.status === 413 ? "Файл слишком большой (до 4 МБ)" : `Не загрузилось (${res.status})`));
        push([json as UploadedFile]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не загрузилось");
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((f) => (
          <div key={f.id} className="relative">
            {f.mime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.url} alt={f.name} className="size-20 rounded-md object-cover hairline" />
            ) : (
              <div className="flex h-20 w-32 flex-col justify-between rounded-md bg-surface-2 p-2 hairline">
                <FileText className="size-5 text-muted" />
                <div className="truncate text-[11px] font-medium">{f.name}</div>
                <div className="text-[10px] text-dim">{fmtBytes(f.size)}</div>
              </div>
            )}
            <button
              type="button"
              aria-label="Убрать"
              onClick={() => onChange(value.filter((x) => x.id !== f.id))}
              className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-fg text-bg"
            >
              <X className="size-3.5" strokeWidth={3} />
            </button>
          </div>
        ))}
        {value.length + busy < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn("flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md bg-surface-2 text-muted hairline active:scale-95", busy && "opacity-60")}
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
            <span className="text-[11px]">{busy ? "грузим" : "файл"}</span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept={accept} multiple className="hidden" onChange={(e) => void upload(e.target.files).then(() => (e.target.value = ""))} />
      {error && <div className="text-[13px] text-danger">{error}</div>}
      <div className="text-[11px] text-dim">Фото, PDF, Word, Excel — до 4 МБ каждый. Большие методички лучше ссылкой в тексте.</div>
    </div>
  );
}
