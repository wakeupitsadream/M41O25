"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ScanLine, Sparkles, Wand2 } from "lucide-react";
import type { DraftLesson } from "@/lib/ocr/draft";
import { applyDraft } from "@/app/admin/actions/import";
import { capitalize, fmtDayMonth, fmtWeekday } from "@/lib/schedule/time";
import { KIND_LABEL } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/primitives";
import { AttachmentUploader, type UploadedFile } from "@/components/hw/attachment-uploader";
import { cn, pluralRu } from "@/lib/utils";

type Recognized = { importId: string; model: string; attempts: number; groupFound: boolean; groupLabel: string | null; weekType: "upper" | "lower" | null; notes: string; draft: DraftLesson[]; durationMs?: number; schemaFallback?: boolean };

const PARITY_LABEL = { upper: "верхняя", lower: "нижняя" } as const;

/**
 * Субботний ритуал: загрузил 1–3 фото скана → распознали только нашу группу → проверил → применил в неделю.
 * Отказ Polza никогда не блокирует: тот же редактор заполняется руками.
 */
export function ScanRecognizer({ weekId, hasLessons, subjects, parity = null }: { weekId: string; hasLessons: boolean; subjects: { id: string; name: string }[]; parity?: "upper" | "lower" | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState<null | "fast" | "strong">(null);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<Recognized | null>(null);
  const [pending, start] = useTransition();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const recognize = async (strong: boolean) => {
    setError(null);
    setBusy(strong ? "strong" : "fast");
    // Сервер живёт до 120 с; клиент ждёт 110, чтобы показать понятную ошибку, а не вечный спиннер.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 110_000);
    try {
      const res = await fetch("/api/admin/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId, attachmentIds: files.map((f) => f.id), strong }),
        signal: ctrl.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Не удалось распознать");
      setRec(json as Recognized);
    } catch (e) {
      setError(e instanceof Error && e.name === "AbortError" ? "Модель не ответила за 110 секунд — попробуй одно фото или сильную модель" : e instanceof Error ? e.message : "Не удалось распознать");
    } finally {
      clearTimeout(timer);
      setBusy(null);
    }
  };

  const toggle = (key: string) => rec && setRec({ ...rec, draft: rec.draft.map((d) => (d.key === key ? { ...d, include: !d.include } : d)) });
  const included = rec?.draft.filter((d) => d.include) ?? [];
  const uncertainCount = included.filter((d) => d.uncertain).length;
  const hiddenByParity = rec?.draft.filter((d) => !d.include && d.weekType !== "both").length ?? 0;
  const parityMismatch = Boolean(rec?.weekType && parity && rec.weekType !== parity);
  const parityUnknown = parity === null && (rec?.draft.some((d) => d.weekType !== "both") ?? false);

  const apply = () => {
    if (!rec) return;
    if (parityUnknown) return setError("На скане есть пары только верхней или нижней недели, а у этой недели чётность не указана. Укажи её в шапке редактора и распознай ещё раз.");
    if (hasLessons && !window.confirm("В неделе уже есть пары. Заменить их распознанными?")) return;
    start(async () => {
      const res = await applyDraft(
        weekId,
        rec.importId,
        included.map((d) => ({ date: d.date, slot: d.slot, startsAt: d.startsAt, endsAt: d.endsAt, title: d.title, subjectId: d.subjectId, room: d.room, teacherName: d.teacherName, kind: d.kind })),
        hasLessons,
      );
      if (!res.ok) return setError(res.error);
      setOpen(false);
      setRec(null);
      setFiles([]);
      router.refresh();
    });
  };

  const days = [...new Set(rec?.draft.map((d) => d.date) ?? [])];

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ScanLine className="size-4" /> По скану
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Распознать скан">
        {!rec ? (
          <div className="space-y-4 pb-2">
            <p className="text-[13px] text-muted">
              Фото или скан документа со всеми группами — 1–3 изображения в порядке страниц. Сними так, чтобы столбец группы и шапка с днями и временем занимали весь кадр. Модель вытащит только нашу группу, дальше проверишь и поправишь тапом.
            </p>
            <AttachmentUploader entityType="scan" value={files} onChange={setFiles} max={3} accept="image/jpeg,image/png,image/webp" />
            {error && (
              <div className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2.5 text-[13px] text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
              </div>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={!files.length || busy !== null} loading={busy === "fast"} onClick={() => recognize(false)}>
                <Wand2 className="size-4" /> Распознать
              </Button>
              <Button variant="secondary" disabled={!files.length || busy !== null} loading={busy === "strong"} onClick={() => recognize(true)} title="Медленнее и дороже, но точнее">
                <Sparkles className="size-4" /> Сильной
              </Button>
            </div>
            {busy && (
              <p className="text-center text-[12px] text-dim">
                Обычно 20–60 секунд, до полутора минут. Не сворачивай приложение · {elapsed} с
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <Badge tone={rec.groupFound ? "ok" : "danger"}>{rec.groupFound ? "группа найдена" : "группа не найдена"}</Badge>
              {rec.groupLabel && <Badge>найдена как «{rec.groupLabel}»</Badge>}
              {rec.weekType && <Badge tone={parityMismatch ? "warn" : "neutral"}>{PARITY_LABEL[rec.weekType]} на скане</Badge>}
              <span className="text-dim">
                {rec.model}
                {rec.durationMs ? ` · ${Math.round(rec.durationMs / 1000)} с` : ""}
              </span>
            </div>
            {parityMismatch && rec.weekType && parity && (
              <p className="flex items-start gap-1.5 rounded-md bg-warn/10 px-3 py-2 text-[12px] text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> На скане {PARITY_LABEL[rec.weekType]} неделя, а эта неделя помечена как {PARITY_LABEL[parity]} — проверь чётность в шапке редактора, иначе пары уедут на другую неделю.
              </p>
            )}
            {parityUnknown && (
              <p className="flex items-start gap-1.5 rounded-md bg-warn/10 px-3 py-2 text-[12px] text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> На скане есть пары только верхней или нижней недели, а чётность этой недели не указана. Укажи её в шапке — иначе применить нельзя.
              </p>
            )}
            {hiddenByParity > 0 && <p className="text-[12px] text-dim">Скрыто {hiddenByParity} {pluralRu(hiddenByParity, "пара", "пары", "пар")} другой чётности — они относятся к соседней неделе.</p>}
            {rec.notes && <p className="rounded-md bg-surface-2 px-3 py-2 text-[12px] text-muted">{rec.notes}</p>}
            {uncertainCount > 0 && (
              <p className="flex items-center gap-1.5 text-[12px] text-warn">
                <AlertTriangle className="size-3.5" /> {uncertainCount} {pluralRu(uncertainCount, "ячейка", "ячейки", "ячеек")} под сомнением — проверь по raw-тексту
              </p>
            )}
            {days.map((date) => (
              <div key={date} className="overflow-hidden rounded-lg bg-surface hairline">
                <div className="px-3 py-2 font-display text-[13px] font-bold">
                  {capitalize(fmtWeekday(date))} <span className="font-sans font-medium text-muted">{fmtDayMonth(date)}</span>
                </div>
                <ul className="divide-y divide-border border-t border-border">
                  {rec.draft
                    .filter((d) => d.date === date)
                    .map((d) => (
                      <li key={d.key}>
                        <button type="button" onClick={() => toggle(d.key)} className={cn("flex w-full items-start gap-2.5 px-3 py-2 text-left", !d.include && "opacity-40")}>
                          <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2", d.include ? "border-accent bg-accent text-accent-ink" : "border-border-strong")}>
                            {d.include && <Check className="size-3" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
                              <span className="font-semibold tnum">{d.slot}.</span>
                              <span className={cn("font-medium", d.uncertain && "text-warn")}>{d.title}</span>
                              {!d.subjectId && <Badge tone="warn">нет в справочнике</Badge>}
                              {d.weekType !== "both" && <Badge>{d.weekType === "upper" ? "верх" : "низ"}</Badge>}
                            </span>
                            <span className="block text-[12px] text-muted">
                              {[d.startsAt && `${d.startsAt}–${d.endsAt}`, KIND_LABEL[d.kind], d.room, d.teacherName].filter(Boolean).join(" · ")}
                            </span>
                            {d.uncertain && <span className="block text-[11px] text-dim">raw: {d.rawText}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            {rec.draft.length === 0 && <p className="text-center text-[13px] text-muted">Пар не найдено. Перефотографируй нужную страницу или заполни вручную.</p>}
            {error && <div className="text-[13px] text-danger">{error}</div>}
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" onClick={() => setRec(null)}>
                Назад
              </Button>
              <Button className="flex-1" loading={pending} disabled={included.length === 0 || parityUnknown} onClick={apply}>
                Применить {included.length} {pluralRu(included.length, "пару", "пары", "пар")}
              </Button>
            </div>
            <p className="text-[11px] text-dim">
              Предметы вне справочника ({subjects.length} шт.) сохранятся текстом — позже их можно привязать в редакторе.
            </p>
          </div>
        )}
      </Sheet>
    </>
  );
}
