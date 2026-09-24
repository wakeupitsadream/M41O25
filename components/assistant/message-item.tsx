"use client";

import { memo } from "react";
import dynamic from "next/dynamic";
import { FileText, RotateCw, Zap } from "lucide-react";
import { ImageGrid } from "@/components/ui/image-grid";
import { toolLabel } from "@/lib/assistant/client/format";
import type { UiMessage, replyStage } from "@/lib/assistant/client/chat-state";

/**
 * react-markdown с remark-gfm — отдельным чанком: на хабе и в списке бесед он не нужен. На сервере рендерится
 * как обычно (ssr по умолчанию), так что история беседы приходит уже размеченной, без мигания сырым текстом.
 */
const Markdown = dynamic(() => import("./markdown"), { loading: () => <span className="block h-5 w-2/3 rounded-md skeleton" /> });

type Stage = ReturnType<typeof replyStage>;

/** Документ в сообщении — просто чип с именем, не ссылка: открыть его внутри PWA без кнопки «назад» было бы ловушкой, а внешний браузер файлы помощника не отдаёт. */
function DocChip({ name }: { name: string }) {
  return (
    <span className="inline-flex h-9 max-w-full items-center gap-2 rounded-full bg-surface-2 px-3 text-[13px] hairline">
      <FileText className="size-4 shrink-0 text-muted" />
      <span className="truncate">{name}</span>
    </span>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex h-8 items-center gap-2.5 text-[14px] text-muted">
      <span aria-hidden className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 180}ms` }} />
        ))}
      </span>
      {label}
    </div>
  );
}

const statusNote = (m: UiMessage) => m.note ?? (m.status === "error" ? "Ответ не получен" : m.status === "aborted" ? "Ответ прервался" : null);

/**
 * Одно сообщение ленты. memo с примитивными пропсами: во время стрима меняется объект только идущего ответа,
 * остальные пузыри (и их markdown) не перерисовываются на каждый кусок текста.
 */
export const MessageItem = memo(function MessageItem({ m, stage, canRetry, onRetry }: { m: UiMessage; stage: Stage; canRetry: boolean; onRetry: (key: string) => void }) {
  const images = m.attachments.filter((a) => a.mime.startsWith("image/"));
  const docs = m.attachments.filter((a) => !a.mime.startsWith("image/"));

  if (m.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5 pl-10">
        {images.length > 0 && <ImageGrid images={images} className="w-full max-w-64" rounded="rounded-md" singleMax="max-h-64" />}
        {docs.length > 0 && (
          <div className="flex max-w-full flex-wrap justify-end gap-1.5">
            {docs.map((d) => (
              <DocChip key={d.id} name={d.name} />
            ))}
          </div>
        )}
        {m.content.trim() && (
          <div className="whitespace-pre-wrap rounded-[1.25rem] rounded-br-md bg-surface-2 px-3.5 py-2.5 text-[15px] leading-relaxed [overflow-wrap:anywhere]">{m.content}</div>
        )}
        {m.strong && (
          <span className="flex items-center gap-1 text-[11px] text-dim">
            <Zap className="size-3" /> сильный режим
          </span>
        )}
      </div>
    );
  }

  const note = statusNote(m);
  const silent = !m.content && !stage && m.status === "done";
  return (
    <div className="pr-2 text-[15px] leading-relaxed">
      {m.content && <Markdown text={m.content} />}
      {stage && <Thinking label={stage.kind === "tool" ? toolLabel(stage.name) : "думает…"} />}
      {silent && <p className="text-muted">Помощник ничего не ответил — спроси иначе</p>}
      {note && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1 text-[13px] text-dim">
          <span>{note}</span>
          {canRetry && (
            <button type="button" onClick={() => onRetry(m.key)} className="flex h-10 items-center gap-1.5 rounded-full px-2.5 font-semibold text-muted active:bg-surface-2">
              <RotateCw className="size-3.5" /> Повторить
            </button>
          )}
        </div>
      )}
    </div>
  );
});
