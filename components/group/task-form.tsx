"use client";

import { useState, useTransition } from "react";
import { useGuardedRouter } from "@/components/features/nav-guard";
import { ListChecks } from "lucide-react";
import { createTask } from "@/app/(app)/group/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function TaskForm() {
  const router = useGuardedRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [trackChecks, setTrackChecks] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Field label="Что сделать">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Сдать 500 ₽ на подарок" />
      </Field>
      <Field label="Подробности">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Кому, куда переводить, что принести" className="min-h-24" />
      </Field>
      <Field label="Срок">
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <button
        type="button"
        onClick={() => setTrackChecks((v) => !v)}
        className={cn("flex w-full items-center gap-3 rounded-md px-3.5 py-3 text-left text-[14px] hairline", trackChecks ? "bg-accent/15 text-accent" : "bg-surface-2")}
      >
        <ListChecks className="size-4" />
        <span className="flex-1">
          Чек-лист «кто сдал»
          <span className="block text-[12px] opacity-70">Отмечает только админ — так данные не разъезжаются</span>
        </span>
        <span className={cn("size-5 rounded-full border-2", trackChecks ? "border-accent bg-accent" : "border-border-strong")} />
      </button>
      {error && <div className="text-[13px] text-danger">{error}</div>}
      <Button
        size="lg"
        className="w-full"
        loading={pending}
        disabled={title.trim().length < 2}
        onClick={() =>
          start(async () => {
            const res = await createTask({ title, description, dueDate, trackChecks });
            if (!res.ok) return setError(res.error);
            router.replace(`/group/tasks/${res.data!.id}`);
          })
        }
      >
        Создать
      </Button>
    </div>
  );
}
