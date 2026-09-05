"use client";

import Link from "next/link";
import { useGuardedRouter } from "@/components/features/nav-guard";
import { useState, useTransition } from "react";
import { CalendarDays, Check, Copy, FileText, MessageCircle, Paperclip, Pencil, PencilLine, Send, Trash2, Undo2, X } from "lucide-react";
import {
  addComment,
  addEdit,
  attachToHomework,
  deleteComment,
  deleteEdit,
  deleteHomework,
  markDuplicate,
  removeAttachment,
  toggleDone,
  updateHomework,
} from "@/app/(app)/hw/actions";
import { dueLabel, fmtBytes, fmtDateTime } from "@/lib/hw/format";
import { fmtDayShort, fmtWeekday } from "@/lib/schedule/time";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar, Badge } from "@/components/ui/primitives";
import { ImageGrid } from "@/components/ui/image-grid";
import { ReactionBar } from "@/components/group/reaction-bar";
import { AttachmentUploader, type UploadedFile } from "./attachment-uploader";
import type { ReactionSummary } from "@/lib/group/query";
import { cn, displayName } from "@/lib/utils";

type Person = { id: string; fullName: string; nickname: string | null; avatarEmoji: string; color: string };
type Attachment = { id: string; name: string; mime: string; size: number; url: string; uploadedBy: string };

export type HwDetailData = {
  id: string;
  title: string | null;
  body: string;
  dueDate: string;
  createdAt: string;
  subject: { id: string; name: string; shortName: string | null; color: string | null } | null;
  author: Person;
  done: boolean;
  duplicateOfId: string | null;
  duplicateMarkedBy: string | null;
  original: { id: string; title: string | null; body: string } | null;
  duplicates: { id: string; title: string | null; body: string }[];
  edits: { id: string; text: string; createdAt: string; author: Person; attachments: Attachment[] }[];
  comments: { id: string; body: string; createdAt: string; author: Person }[];
  attachments: Attachment[];
  reactions: ReactionSummary;
  /** Пара, к которой привязана запись (если она ещё есть в расписании). */
  lesson: { id: string; date: string; startsAt: string; endsAt: string; room: string | null; isCancelled: boolean } | null;
};

type Props = {
  hw: HwDetailData;
  me: { id: string; isAdmin: boolean; isModerator: boolean; showDone: boolean };
  today: string;
  candidates: { id: string; title: string | null; body: string; dueDate: string }[];
  subjects: { id: string; name: string; shortName: string | null; color: string | null }[];
};

/** Потолки как в actions.ts: 10 файлов у записи, 4 у блока «Дополнить». */
const MAX_HW_FILES = 10;
const MAX_EDIT_FILES = 4;

export function HwDetail({ hw, me, today, candidates, subjects }: Props) {
  const router = useGuardedRouter();
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState<null | "edit-add" | "dup" | "edit-orig" | "files">(null);
  const [editText, setEditText] = useState("");
  const [editFiles, setEditFiles] = useState<UploadedFile[]>([]);
  const [newFiles, setNewFiles] = useState<UploadedFile[]>([]);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [orig, setOrig] = useState({ title: hw.title ?? "", body: hw.body, dueDate: hw.dueDate, subjectId: hw.subject?.id ?? null });

  const canEditOrig = me.isAdmin || hw.author.id === me.id;
  // Файлы к чужой записи добавляют автор, староста и админ; своё фото любой может приложить блоком «Дополнить».
  const canManageFiles = me.isAdmin || me.isModerator || hw.author.id === me.id;
  const canRemoveFile = (a: Attachment) => canManageFiles || a.uploadedBy === me.id;
  const due = dueLabel(hw.dueDate, today);
  const color = hw.subject?.color ?? "#9C9CA8";

  const run = (fn: () => Promise<{ ok: boolean; error?: string } | void>, after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res && !res.ok) return setError(res.error ?? "Ошибка");
      after?.();
      router.refresh();
    });
  };

  return (
    <div className="space-y-5 pb-6">
      {hw.original && (
        <div className="flex items-center gap-2 rounded-md bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
          <Copy className="size-4 shrink-0" />
          <span className="flex-1">
            Дубль записи{" "}
            <Link href={`/hw/${hw.original.id}`} className="font-semibold underline underline-offset-2">
              «{(hw.original.title ?? hw.original.body).slice(0, 40)}»
            </Link>
          </span>
          {(me.isAdmin || hw.duplicateMarkedBy === me.id) && (
            <button type="button" className="font-semibold" onClick={() => run(() => markDuplicate(hw.id, null))}>
              снять
            </button>
          )}
        </div>
      )}

      <header>
        <div className="flex flex-wrap items-center gap-2">
          {hw.subject ? (
            <span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: `${color}22`, color }}>
              {hw.subject.name}
            </span>
          ) : (
            <Badge>Без предмета</Badge>
          )}
          <Badge tone={due.tone}>{due.text}</Badge>
        </div>
        {hw.title && <h1 className="mt-3 font-display text-[26px] font-bold leading-tight">{hw.title}</h1>}
        <p className={cn("mt-3 whitespace-pre-wrap text-[17px] leading-relaxed", hw.done && "line-through decoration-muted")}>{hw.body}</p>
        <div className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <Avatar user={hw.author} size="xs" />
          <span>{displayName(hw.author)}</span>
          <span>·</span>
          <span>{fmtDateTime(hw.createdAt)}</span>
        </div>
        {hw.lesson && (
          <Link
            href={`/s/d/${hw.lesson.date}`}
            className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[13px] font-medium text-muted hairline active:bg-surface-3"
          >
            <CalendarDays className="size-3.5" />
            к паре {fmtWeekday(hw.lesson.date, false)}, {fmtDayShort(hw.lesson.date)} · {hw.lesson.startsAt}
            {hw.lesson.room ? ` · ${hw.lesson.room}` : ""}
            {hw.lesson.isCancelled ? " · отменена" : ""}
          </Link>
        )}
      </header>

      <ReactionBar entityType="homework" entityId={hw.id} reactions={hw.reactions} />
      <Files items={hw.attachments} />

      {hw.edits.length > 0 && (
        <section className="space-y-2">
          {hw.edits.map((e) => (
            <div key={e.id} className="relative rounded-md py-2.5 pl-4 pr-3" style={{ background: `${e.author.color}14`, boxShadow: `inset 3px 0 0 ${e.author.color}` }}>
              <div className="flex items-center gap-2 text-[12px]" style={{ color: e.author.color }}>
                <Avatar user={e.author} size="xs" />
                <span className="font-semibold">{displayName(e.author)}</span>
                <span className="text-dim">дополнил · {fmtDateTime(e.createdAt)}</span>
                {(me.isAdmin || e.author.id === me.id) && (
                  <button type="button" aria-label="Удалить дополнение" className="ml-auto grid size-10 -mr-2 place-items-center text-dim" onClick={() => run(() => deleteEdit(e.id))}>
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              {e.text && <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-fg">{e.text}</p>}
              {e.attachments.length > 0 && (
                <div className="mt-2">
                  <Files items={e.attachments} compact />
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setSheet("edit-add")}>
          <PencilLine className="size-4" /> Дополнить
        </Button>
        {me.showDone && (
          <Button variant={hw.done ? "primary" : "secondary"} loading={pending} onClick={() => run(() => toggleDone(hw.id))}>
            <Check className="size-4" strokeWidth={3} /> {hw.done ? "Сделано" : "Сделал"}
          </Button>
        )}
        {!hw.original && candidates.length > 0 && (
          <Button variant="secondary" onClick={() => setSheet("dup")}>
            <Copy className="size-4" /> Это дубль
          </Button>
        )}
        {canEditOrig && (
          <Button variant="secondary" onClick={() => setSheet("edit-orig")}>
            <Pencil className="size-4" /> Изменить
          </Button>
        )}
        {canManageFiles && (
          <Button variant="secondary" onClick={() => setSheet("files")}>
            <Paperclip className="size-4" /> Файлы{hw.attachments.length > 0 ? ` · ${hw.attachments.length}` : ""}
          </Button>
        )}
      </div>

      {hw.duplicates.length > 0 && (
        <div className="text-[13px] text-muted">
          Дубли этой записи: {hw.duplicates.length} — {hw.duplicates.map((d) => (
            <Link key={d.id} href={`/hw/${d.id}`} className="underline underline-offset-2">
              «{(d.title ?? d.body).slice(0, 24)}»
            </Link>
          )).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
          <MessageCircle className="size-4" /> Уточнения {hw.comments.length > 0 && <span className="text-dim">{hw.comments.length}</span>}
        </h2>
        {hw.comments.map((c) => (
          <div key={c.id} className="flex gap-2.5">
            <Avatar user={c.author} size="sm" className="mt-0.5" />
            <div className="min-w-0 flex-1 rounded-lg rounded-tl-sm bg-surface px-3.5 py-2.5 hairline">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <span className="font-semibold" style={{ color: c.author.color }}>
                  {displayName(c.author)}
                </span>
                <span>{fmtDateTime(c.createdAt)}</span>
                {(me.isAdmin || c.author.id === me.id) && (
                  <button type="button" aria-label="Удалить" className="ml-auto text-dim" onClick={() => run(() => deleteComment(c.id))}>
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{c.body}</p>
            </div>
          </div>
        ))}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) run(() => addComment(hw.id, comment), () => setComment(""));
          }}
        >
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="«А точно к пятнице?», «препод сказал ещё №3»" className="min-h-12 flex-1 py-2.5" rows={1} />
          <Button type="submit" size="icon" loading={pending} disabled={!comment.trim()} aria-label="Отправить">
            <Send className="size-4" />
          </Button>
        </form>
      </section>

      {error && <div className="text-[13px] text-danger">{error}</div>}

      {canEditOrig && (
        <button
          type="button"
          className="mx-auto flex items-center gap-1.5 text-[13px] text-dim"
          onClick={() => {
            if (window.confirm("Удалить запись? Дополнения и комментарии уйдут вместе с ней.")) run(() => deleteHomework(hw.id));
          }}
        >
          <Trash2 className="size-3.5" /> Удалить запись
        </button>
      )}

      <Sheet open={sheet === "edit-add"} onClose={() => setSheet(null)} title="Дополнить запись">
        <p className="mb-3 text-[13px] text-muted">Твой блок появится под оригиналом с твоим цветом. Оригинал автора не меняется. Можно приложить фото доски.</p>
        <Textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="Ещё нужно принести распечатку…" className="min-h-28" />
        <div className="mt-3">
          <AttachmentUploader value={editFiles} onChange={setEditFiles} max={MAX_EDIT_FILES} />
        </div>
        <Button
          className="mt-3 w-full"
          loading={pending}
          disabled={!editText.trim() && editFiles.length === 0}
          onClick={() =>
            run(
              () => addEdit(hw.id, editText, editFiles.map((f) => f.id)),
              () => {
                setEditText("");
                setEditFiles([]);
                setSheet(null);
              },
            )
          }
        >
          Добавить
        </Button>
      </Sheet>

      <Sheet open={sheet === "files"} onClose={() => setSheet(null)} title="Фото и файлы">
        <p className="mb-3 text-[13px] text-muted">Файлы записи видят все. Убрать своё может каждый; любое — автор записи, староста и админ.</p>
        {hw.attachments.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-3">
            {hw.attachments.map((a) => (
              <div key={a.id} className="relative">
                {a.mime.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.name} className="size-24 rounded-md object-cover hairline" />
                ) : (
                  <div className="flex h-24 w-36 flex-col justify-between rounded-md bg-surface-2 p-2 hairline">
                    <FileText className="size-5 text-muted" />
                    <div className="truncate text-[11px] font-medium">{a.name}</div>
                    <div className="text-[10px] text-dim">{fmtBytes(a.size)}</div>
                  </div>
                )}
                {canRemoveFile(a) && (
                  <button
                    type="button"
                    aria-label={`Убрать ${a.name}`}
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Убрать «${a.name}»? Файл удалится.`)) run(() => removeAttachment(a.id));
                    }}
                    className="absolute -right-2 -top-2 grid size-10 place-items-center rounded-full bg-fg text-bg shadow-float active:scale-95"
                  >
                    <X className="size-4" strokeWidth={3} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {hw.attachments.length < MAX_HW_FILES ? (
          <AttachmentUploader value={newFiles} onChange={setNewFiles} max={MAX_HW_FILES - hw.attachments.length} />
        ) : (
          <p className="text-[13px] text-dim">Уже {MAX_HW_FILES} файлов — потолок. Убери лишнее, чтобы добавить новое.</p>
        )}
        <Button
          className="mt-3 w-full"
          loading={pending}
          disabled={newFiles.length === 0}
          onClick={() =>
            run(
              () => attachToHomework(hw.id, newFiles.map((f) => f.id)),
              () => {
                setNewFiles([]);
                setSheet(null);
              },
            )
          }
        >
          Прикрепить{newFiles.length > 0 ? ` (${newFiles.length})` : ""}
        </Button>
      </Sheet>

      <Sheet open={sheet === "dup"} onClose={() => setSheet(null)} title="Дубль какой записи?">
        <p className="mb-3 text-[13px] text-muted">Запись свернётся и будет вести на оригинал. Снять отметку сможешь ты или админ.</p>
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full rounded-md bg-surface-2 px-3.5 py-3 text-left hairline active:bg-surface-3"
                onClick={() => run(() => markDuplicate(hw.id, c.id), () => setSheet(null))}
              >
                <div className="line-clamp-2 text-[14px] font-medium">{c.title ?? c.body}</div>
                <div className="mt-0.5 text-[12px] text-muted">{dueLabel(c.dueDate, today).text}</div>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet open={sheet === "edit-orig"} onClose={() => setSheet(null)} title="Изменить запись">
        <div className="space-y-3">
          <Field label="Предмет">
            <Select value={orig.subjectId ?? ""} onChange={(e) => setOrig({ ...orig, subjectId: e.target.value || null })}>
              <option value="">Без предмета</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Заголовок">
            <Input value={orig.title} onChange={(e) => setOrig({ ...orig, title: e.target.value })} />
          </Field>
          <Field label="Текст">
            <Textarea value={orig.body} onChange={(e) => setOrig({ ...orig, body: e.target.value })} className="min-h-32" />
          </Field>
          <Field label="Дедлайн" hint="Привязка к паре пересчитается по предмету и дате">
            <Input type="date" value={orig.dueDate} onChange={(e) => setOrig({ ...orig, dueDate: e.target.value })} />
          </Field>
          <Button className="w-full" loading={pending} onClick={() => run(() => updateHomework(hw.id, orig), () => setSheet(null))}>
            Сохранить
          </Button>
          <p className="text-[12px] text-dim">В ленту «Что нового» попадёт только существенная правка: другой предмет, дедлайн или текст. Опечатки — нет.</p>
          {hw.done && (
            <p className="flex items-center gap-1 text-[12px] text-dim">
              <Undo2 className="size-3" /> Отметка «сделано» останется твоей личной
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
}

/** Фото — сеткой с просмотром внутри приложения (без внешнего браузера), документы — списком. */
function Files({ items, compact = false }: { items: Attachment[]; compact?: boolean }) {
  if (items.length === 0) return null;
  const images = items.filter((a) => a.mime.startsWith("image/"));
  const docs = items.filter((a) => !a.mime.startsWith("image/"));
  return (
    <div className="space-y-2">
      {images.length > 0 && <ImageGrid images={images} rounded={compact ? "rounded-md" : "rounded-lg"} singleMax={compact ? "max-h-64" : "max-h-96"} />}
      {docs.length > 0 && (
        <ul className="space-y-2">
          {docs.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer" className={cn("flex items-center gap-3 rounded-md bg-surface px-3.5 hairline active:bg-surface-2", compact ? "py-2.5" : "py-3")}>
                <FileText className="size-5 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{a.name}</span>
                  <span className="text-[12px] text-dim">{fmtBytes(a.size)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
