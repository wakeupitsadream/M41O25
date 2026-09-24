"use client";

import { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowUp, FileText, Loader2, Paperclip, Square, X } from "lucide-react";
import { Textarea } from "@/components/ui/input";
import { isOfflineError } from "@/lib/hw/draft";
import { cn } from "@/lib/utils";
import { goToLogin } from "./go-to-login";
import { ACCEPT, MAX_FILES, UploadError, uploadForAssistant, type Uploaded } from "./upload";

/** До 6 строк поле растёт, дальше прокручивается внутри (docs/AI-CHAT.md §8). */
const MAX_LINES = 6;
/** Ограничение сервера на текст сообщения (§7) — не даём набрать больше, чем он примет. */
const MAX_TEXT = 4000;

export const COMPOSER_INPUT_ID = "assistant-input";

type Props = {
  text: string;
  onText: (t: string) => void;
  files: Uploaded[];
  setFiles: Dispatch<SetStateAction<Uploaded[]>>;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
};

/**
 * Поле ввода чата: авто-рост textarea, вложения чипами, отправка / «Стоп». Cmd/Ctrl+Enter отправляет,
 * обычный Enter — перенос строки (на телефоне это единственная клавиша переноса).
 */
export function Composer({ text, onText, files, setFiles, streaming, onSend, onStop }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Авто-рост: сбросить высоту и взять scrollHeight, но не выше 6 строк — дальше внутренний скролл.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 24;
    const max = line * MAX_LINES + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const room = Math.max(0, MAX_FILES - files.length - busy);
    const picked = Array.from(list).slice(0, room);
    if (list.length > picked.length) setError(`В одном сообщении — не больше ${MAX_FILES} файлов`);
    setBusy((b) => b + picked.length);
    // По одному, а не разом: сжатие четырёх фото параллельно на iPhone упирается в память вкладки.
    for (const file of picked) {
      try {
        const up = await uploadForAssistant(file);
        setFiles((prev) => (prev.length >= MAX_FILES ? prev : [...prev, up]));
      } catch (e) {
        if (e instanceof UploadError && e.status === 401) {
          goToLogin();
          return;
        }
        setError(isOfflineError(e, navigator.onLine) ? "Нет сети — файл не загрузился" : e instanceof Error ? e.message : "Не загрузилось");
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };

  const ready = !streaming && busy === 0 && (text.trim().length > 0 || files.length > 0);
  const canAttach = files.length + busy < MAX_FILES;

  return (
    <>
      {(files.length > 0 || busy > 0) && (
        <div className="-mx-3 mb-2 flex gap-2 overflow-x-auto px-3 scrollbar-none">
          {files.map((f) => (
            <div key={f.id} className="flex h-11 max-w-[14rem] shrink-0 items-center gap-2 rounded-full bg-surface-2 pl-1.5 hairline">
              {f.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.url} alt="" className="size-8 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3">
                  <FileText className="size-4 text-muted" />
                </span>
              )}
              <span className="min-w-0 truncate text-[13px]">{f.name}</span>
              <button
                type="button"
                aria-label={`Убрать ${f.name}`}
                onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                className="grid size-10 shrink-0 place-items-center rounded-full text-muted active:bg-surface-3"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          {busy > 0 && (
            <div className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-surface-2 px-3.5 text-[13px] text-muted hairline">
              <Loader2 className="size-4 animate-spin" /> загружаю{busy > 1 ? ` ${busy}` : ""}…
            </div>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="mb-1.5 px-1 text-[12px] leading-snug text-danger">
          {error}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="Прикрепить фото или документ"
          disabled={!canAttach}
          onClick={() => picker.current?.click()}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-muted active:bg-surface-3 disabled:opacity-40"
        >
          <Paperclip className="size-[18px]" />
        </button>
        <Textarea
          ref={area}
          id={COMPOSER_INPUT_ID}
          rows={1}
          value={text}
          maxLength={MAX_TEXT}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (ready) onSend();
            }
          }}
          placeholder="Спроси про учёбу"
          aria-label="Сообщение помощнику"
          enterKeyHint="enter"
          className="min-h-10 flex-1 rounded-[1.25rem] px-4 py-2 leading-6"
        />
        {streaming ? (
          <button
            type="button"
            aria-label="Остановить ответ"
            // preventDefault на mousedown не забирает фокус у поля: клавиатура iPhone не прыгает вниз-вверх.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onStop}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-fg text-bg active:scale-95"
          >
            <Square className="size-3.5" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Отправить"
            disabled={!ready}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSend}
            className={cn("grid size-10 shrink-0 place-items-center rounded-full transition active:scale-95", ready ? "bg-accent text-accent-ink" : "bg-surface-2 text-dim")}
          >
            <ArrowUp className="size-5" strokeWidth={2.6} />
          </button>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const input = e.currentTarget;
          void upload(input.files).finally(() => (input.value = ""));
        }}
      />
    </>
  );
}
