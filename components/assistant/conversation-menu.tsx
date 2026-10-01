"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis, EyeOff, Loader2, Pencil } from "lucide-react";
import { archiveConversation, renameConversation } from "@/app/(app)/group/assistant/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

/** Предел заголовка — как у titleSchema в server action: не даём набрать больше, чем примет сервер. */
const TITLE_MAX = 80;

const OFFLINE = "Не сохранилось — нет сети";

type Props = {
  conversationId: string;
  title: string;
  /** Во время стрима действия выключены: ответ server action обновляет страницу, и refresh не должен прийтись на идущий ответ. */
  disabled?: boolean;
  onRenamed: (title: string) => void;
};

/**
 * «⋯» в шапке чата: переименовать беседу или убрать её из списка — server actions были готовы (docs/AI-CHAT.md §7),
 * не хватало клиента. Архив вместо удаления: история и расход остаются, и шторка так и говорит. Для ещё не созданной
 * беседы (/new) кнопку не показывает вызывающий: переименовывать и прятать пока нечего.
 */
export function ConversationMenu({ conversationId, title, disabled, onRenamed }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const [draft, setDraft] = useState(title);
  const [pending, start] = useTransition();

  const show = () => {
    setMode("menu");
    setDraft(title);
    setOpen(true);
  };
  const close = () => {
    if (!pending) setOpen(false);
  };

  const rename = () => {
    const next = draft.trim();
    if (!next) return;
    if (next === title) return setOpen(false);
    start(async () => {
      const res = await renameConversation(conversationId, next).catch(() => null);
      if (!res) return toast(OFFLINE);
      if (!res.ok) return toast(res.error);
      // Заголовок меняем сразу; серверная версия подтвердит его при следующем перечитывании беседы.
      onRenamed(next);
      setOpen(false);
    });
  };

  const archive = () => {
    start(async () => {
      const res = await archiveConversation(conversationId).catch(() => null);
      if (!res) return toast(OFFLINE);
      if (!res.ok) return toast(res.error);
      setOpen(false);
      router.push("/group/assistant");
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Действия с беседой"
        disabled={disabled}
        onClick={show}
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted active:bg-surface-2 disabled:opacity-40"
      >
        <Ellipsis className="size-5" />
      </button>
      <Sheet open={open} onClose={close} title={mode === "rename" ? "Переименовать" : "Беседа"}>
        {mode === "menu" ? (
          <div className="space-y-2 pb-2">
            <button
              type="button"
              onClick={() => setMode("rename")}
              disabled={pending}
              className="flex min-h-12 w-full items-center gap-3 rounded-md bg-surface-2 px-4 text-left text-[15px] font-medium active:bg-surface-3 disabled:opacity-50"
            >
              <Pencil className="size-4 shrink-0 text-muted" /> Переименовать
            </button>
            <button
              type="button"
              onClick={archive}
              disabled={pending}
              className="flex min-h-12 w-full items-center gap-3 rounded-md bg-surface-2 px-4 text-left text-[15px] font-medium active:bg-surface-3 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 shrink-0 animate-spin text-muted" /> : <EyeOff className="size-4 shrink-0 text-muted" />} Убрать из списка
            </button>
            <p className="px-1 text-[13px] leading-snug text-dim">Беседа скроется из списка, но история и расход сохранятся.</p>
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={TITLE_MAX}
              aria-label="Название беседы"
              placeholder="Название беседы"
              enterKeyHint="done"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  rename();
                }
              }}
            />
            <div className="flex gap-2">
              <Button className="flex-1" loading={pending} disabled={!draft.trim()} onClick={rename}>
                Сохранить
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setMode("menu")}>
                Отмена
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
