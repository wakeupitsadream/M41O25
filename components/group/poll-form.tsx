"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, ListChecks, Plus, X } from "lucide-react";
import { createPoll } from "@/app/(app)/group/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PollForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [isMulti, setMulti] = useState(false);
  const [isAnonymous, setAnon] = useState(false);
  const [closesAt, setClosesAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filled = options.map((o) => o.trim()).filter(Boolean);

  return (
    <div className="space-y-4">
      <Field label="Вопрос">
        <Input autoFocus value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Переносим пару на пятницу?" />
      </Field>
      <div className="space-y-2">
        <span className="block text-[13px] font-medium text-muted">Варианты</span>
        {options.map((o, i) => (
          <div key={i} className="flex gap-2">
            <Input value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Вариант ${i + 1}`} />
            {options.length > 2 && (
              <Button type="button" variant="secondary" size="icon" aria-label="Убрать" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {options.length < 10 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOptions([...options, ""])}>
            <Plus className="size-4" /> Ещё вариант
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Toggle on={isMulti} onClick={() => setMulti((v) => !v)} icon={<ListChecks className="size-4" />} label="Несколько ответов" />
        <Toggle on={isAnonymous} onClick={() => setAnon((v) => !v)} icon={<EyeOff className="size-4" />} label="Скрыть имена" />
      </div>
      {isAnonymous && (
        <p className="text-[12px] text-dim">
          Имена голосовавших не показываются никому в приложении. Технически голос привязан к профилю, чтобы нельзя было голосовать дважды.
        </p>
      )}
      <Field label="Закрыть автоматически (необязательно)">
        <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
      </Field>
      {error && <div className="text-[13px] text-danger">{error}</div>}
      <Button
        size="lg"
        className="w-full"
        loading={pending}
        disabled={question.trim().length < 3 || filled.length < 2}
        onClick={() =>
          start(async () => {
            const res = await createPoll({ question, options: filled, isMulti, isAnonymous, closesAt });
            if (!res.ok) return setError(res.error);
            router.replace("/group/polls");
          })
        }
      >
        Создать опрос
      </Button>
    </div>
  );
}

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex items-center gap-2 rounded-md px-3.5 py-3 text-left text-[13px] font-medium hairline", on ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")}>
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  );
}
