"use client";

import { useRef, useState } from "react";
import { FileText, ImagePlus, Loader2, X } from "lucide-react";
import { fmtBytes } from "@/lib/hw/format";
import { cn } from "@/lib/utils";

export type UploadedFile = { id: string; name: string; mime: string; size: number; url: string };

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";

/** Загрузка вложений: фото сжимаются на клиенте до ~1.5 МБ (лимит тела запроса на Vercel — 4.5 МБ). */
export function AttachmentUploader({
  entityType = "homework",
  value,
  onChange,
  max = 6,
}: {
  entityType?: "homework" | "news" | "task" | "scan";
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files).slice(0, max - value.length);
    setBusy((b) => b + list.length);
    const results: UploadedFile[] = [];
    for (const original of list) {
      try {
        let file = original;
        if (file.type.startsWith("image/") && file.type !== "image/gif") {
          const { default: compress } = await import("browser-image-compression");
          const blob = await compress(file, { maxSizeMB: 1.5, maxWidthOrHeight: 2200, useWebWorker: true, fileType: "image/jpeg", initialQuality: 0.85 });
          file = new File([blob], file.name.replace(/\.(heic|heif|png|webp)$/i, ".jpg"), { type: "image/jpeg" });
        }
        const fd = new FormData();
        fd.set("file", file);
        fd.set("entityType", entityType);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Не загрузилось");
        results.push(json as UploadedFile);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не загрузилось");
      } finally {
        setBusy((b) => b - 1);
      }
    }
    if (results.length) onChange([...value, ...results]);
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
      <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => void upload(e.target.files).then(() => (e.target.value = ""))} />
      {error && <div className="text-[13px] text-danger">{error}</div>}
      <div className="text-[11px] text-dim">Фото, PDF, Word, Excel — до 4 МБ каждый. Большие методички лучше ссылкой в тексте.</div>
    </div>
  );
}
