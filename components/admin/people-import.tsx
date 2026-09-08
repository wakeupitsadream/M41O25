"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, CircleSlash, Users } from "lucide-react";
import { useGuardedRouter } from "@/components/features/nav-guard";
import { importPeople } from "@/app/admin/actions/users";
import { MAX_PEOPLE, planPeopleImport, type PersonLine } from "@/lib/admin/people";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, pluralRu } from "@/lib/utils";

const PLACEHOLDER = `1. Иванов Иван Иванович — 07.03.2006
2. Семёнова Алёна 14.09
3. Петров Пётр`;

/** ДР для предпросмотра: год не показываем — в приложении его всё равно не видно. */
const bd = (p: PersonLine) => {
  if (p.birthdayNote === "bad") return "дату не поняли";
  if (!p.birthday) return null;
  const dm = `${p.birthday.slice(8, 10)}.${p.birthday.slice(5, 7)}`;
  return p.birthdayNote === "no-year" ? `ДР ${dm} (год не указан)` : `ДР ${dm}`;
};

function Row({ p, tone }: { p: PersonLine; tone: "add" | "mute" }) {
  const note = bd(p);
  return (
    <li className={cn("flex min-h-10 items-center gap-2 border-b border-border px-3 py-2 last:border-0", tone === "mute" && "opacity-60")}>
      <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-dim">{p.line}</span>
      <span className="min-w-0 flex-1 truncate text-[14px]">{p.fullName}</span>
      {note && <span className={cn("shrink-0 text-[12px]", p.birthdayNote === "bad" ? "text-warn" : "text-muted")}>{note}</span>}
      {p.status === "exists" && <Badge title={p.existingName === p.fullName ? undefined : `в группе записан как «${p.existingName}»`}>уже есть</Badge>}
      {p.status === "dupe" && <Badge tone="warn">повтор</Badge>}
    </li>
  );
}

function Block({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        {icon}
        {title}
      </h2>
      <ul className="overflow-hidden rounded-lg bg-surface hairline">{children}</ul>
    </section>
  );
}

/**
 * Вставил список из беседы — увидел, кто добавится, кто уже есть и что не разобралось, — нажал одну кнопку.
 * Предпросмотр считается тем же разбором, что и сохранение, но окончательное решение принимает сервер
 * по свежему составу группы.
 */
export function PeopleImport({ existing }: { existing: { fullName: string }[] }) {
  const router = useGuardedRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const plan = useMemo(() => planPeopleImport(text, existing), [text, existing]);
  const fresh = plan.people.filter((p) => p.status === "new");
  const known = plan.people.filter((p) => p.status !== "new");
  const tooMany = fresh.length > MAX_PEOPLE;

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await importPeople(text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const n = res.data?.added ?? 0;
      toast(`Добавили ${n} ${pluralRu(n, "человека", "человека", "человек")}`, "ok");
      setText("");
      router.push("/admin/users");
    });
  };

  return (
    <div className="space-y-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        rows={10}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="min-h-52 w-full resize-y rounded-md bg-surface-2 px-4 py-3 font-mono text-[14px] leading-relaxed text-fg outline-none ring-1 ring-border transition placeholder:text-dim focus:ring-accent/70"
      />

      {text.trim() && (
        <>
          <p className="text-[13px] text-muted">
            Разобрали {plan.counts.parsed} {pluralRu(plan.counts.parsed, "строку", "строки", "строк")} · добавим {plan.counts.add}
            {plan.counts.exists > 0 && ` · уже в группе ${plan.counts.exists}`}
            {plan.counts.dupe > 0 && ` · повторов ${plan.counts.dupe}`}
            {plan.counts.issues > 0 && ` · не поняли ${plan.counts.issues}`}
          </p>

          {fresh.length > 0 && (
            <Block title={`Добавим ${fresh.length}`} icon={<Check className="size-4 text-accent" />}>
              {fresh.map((p) => (
                <Row key={p.line} p={p} tone="add" />
              ))}
            </Block>
          )}

          {known.length > 0 && (
            <Block title={`Пропустим ${known.length}`} icon={<Users className="size-4" />}>
              {known.map((p) => (
                <Row key={p.line} p={p} tone="mute" />
              ))}
            </Block>
          )}

          {plan.issues.length > 0 && (
            <Block title={`Не разобрали ${plan.issues.length}`} icon={<AlertTriangle className="size-4 text-warn" />}>
              {plan.issues.map((i) => (
                <li key={i.line} className="flex min-h-10 items-center gap-2 border-b border-border px-3 py-2 last:border-0">
                  <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-dim">{i.line}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-muted">{i.raw || "—"}</span>
                  <span className="shrink-0 text-[12px] text-warn">{i.reason}</span>
                </li>
              ))}
            </Block>
          )}

          {fresh.length === 0 && plan.counts.parsed > 0 && (
            <p className="flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-[13px] text-muted hairline">
              <CircleSlash className="size-4 shrink-0" /> Новых людей в списке нет — все уже в группе.
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}
      {tooMany && <p className="text-[13px] text-warn">За раз добавляем не больше {MAX_PEOPLE} человек — раздели список.</p>}

      <Button size="lg" className="w-full" onClick={submit} loading={pending} disabled={fresh.length === 0 || tooMany}>
        {fresh.length > 0 ? `Добавить ${fresh.length} ${pluralRu(fresh.length, "человека", "человека", "человек")}` : "Добавить"}
      </Button>
    </div>
  );
}
