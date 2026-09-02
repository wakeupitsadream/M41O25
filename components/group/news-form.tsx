"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin } from "lucide-react";
import { createNews } from "@/app/(app)/group/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { AttachmentUploader, type UploadedFile } from "@/components/hw/attachment-uploader";
import { cn } from "@/lib/utils";

export function NewsForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Field label="Заголовок (необязательно)">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Пары в пятницу отменены" />
      </Field>
      <Field label="Текст">
        <Textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="Что случилось, что делать и до когда. Ссылки станут кликабельными." className="min-h-40 text-[16px]" />
      </Field>
      <Field label="Вложения">
        <AttachmentUploader entityType="news" value={files} onChange={setFiles} />
      </Field>
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        className={cn("flex w-full items-center gap-3 rounded-md px-3.5 py-3 text-left text-[14px] hairline", pinned ? "bg-accent/15 text-accent" : "bg-surface-2")}
      >
        <Pin className="size-4" />
        <span className="flex-1">Закрепить сверху</span>
        <span className={cn("size-5 rounded-full border-2", pinned ? "border-accent bg-accent" : "border-border-strong")} />
      </button>
      {error && <div className="text-[13px] text-danger">{error}</div>}
      <Button
        size="lg"
        className="w-full"
        loading={pending}
        disabled={!body.trim()}
        onClick={() =>
          start(async () => {
            const res = await createNews({ title, body, pinned, attachmentIds: files.map((f) => f.id) });
            if (!res.ok) return setError(res.error);
            router.replace("/group/news");
          })
        }
      >
        Опубликовать
      </Button>
    </div>
  );
}
