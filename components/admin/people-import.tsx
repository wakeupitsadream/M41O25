"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Archive, Check, ChevronRight, CircleSlash, Users } from "lucide-react";
import { useGuardedRouter } from "@/components/features/nav-guard";
import { importPeople } from "@/app/admin/actions/users";
import { MAX_PEOPLE, planPeopleImport, type ExistingPerson, type PersonLine } from "@/lib/admin/people";
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

function Num({ n }: { n: number }) {
  return <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-dim">{n}</span>;
}

function Note({ p }: { p: PersonLine }) {
  const note = bd(p);
  if (!note) return null;
  return <span className={cn("shrink-0 text-[12px]", p.birthdayNote === "bad" ? "text-warn" : "text-muted")}>{note}</span>;
}

/** Строка блока «Добавим»: заводим только отмеченные — шапку списка разбор от человека не отличает. */
function AddRow({ p, checked, onToggle }: { p: PersonLine; checked: boolean; onToggle: () => void }) {
  return (
    <li className="border-b border-border last:border-0">
      <label className="flex min-h-11 items-center gap-2.5 px-3 py-2 active:bg-surface-2">
        <input type="checkbox" checked={checked} onChange={onToggle} className="size-5 shrink-0 accent-accent" />
        <Num n={p.line} />
        <span className={cn("min-w-0 flex-1 truncate text-[14px]", !checked && "text-muted line-through")}>{p.fullName}</span>
        <Note p={p} />
        {p.looksLikeHeading && <Badge tone="warn">заголовок?</Badge>}
      </label>
    </li>
  );
}

/** Строка блока «Пропустим»: человек уже в группе или повторился внутри списка. */
function SkipRow({ p }: { p: PersonLine }) {
  return (
    <li className="flex min-h-10 items-center gap-2 border-b border-border px-3 py-2 opacity-60 last:border-0">
      <Num n={p.line} />
      <span className="min-w-0 flex-1 truncate text-[14px]">{p.fullName}</span>
      <Note p={p} />
      {p.status === "exists" && <Badge title={p.existingName === p.fullName ? undefined : `в группе записан как «${p.existingName}»`}>уже есть</Badge>}
      {p.status === "dupe" && <Badge tone="warn">повтор</Badge>}
    </li>
  );
}

/** Человек из архива: импорт его не вернёт, поэтому даём ссылку прямо в карточку. */
function ArchivedRow({ p }: { p: PersonLine }) {
  const body = (
    <>
      <Num n={p.line} />
      <span className="min-w-0 flex-1 truncate text-[14px]">{p.existingName ?? p.fullName}</span>
      <Badge tone="warn">в архиве</Badge>
      {p.existingId && <ChevronRight className="size-4 shrink-0 text-dim" />}
    </>
  );
  return (
    <li className="border-b border-border last:border-0">
      {p.existingId ? (
        <Link href={`/admin/users/${p.existingId}`} className="flex min-h-11 items-center gap-2 px-3 py-2 active:bg-surface-2">
          {body}
        </Link>
      ) : (
        <span className="flex min-h-11 items-center gap-2 px-3 py-2">{body}</span>
      )}
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
 * Вставил список из беседы — увидел, кто добавится, кто уже есть, кто в архиве и что не разобралось,
 * снял лишние галочки — нажал одну кнопку. Предпросмотр считается тем же разбором, что и сохранение,
 * а на сервер уходят ключи отмеченных строк: добавится ровно то, что админ видел на экране.
 */
export function PeopleImport({ existing }: { existing: ExistingPerson[] }) {
  const router = useGuardedRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Явный выбор админа по ключу строки; чего тут нет — решает эвристика «похоже на заголовок». */
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [pending, start] = useTransition();

  const plan = useMemo(() => planPeopleImport(text, existing), [text, existing]);
  const fresh = plan.people.filter((p) => p.status === "new");
  const archived = plan.people.filter((p) => p.existingStatus === "removed");
  const known = plan.people.filter((p) => p.status !== "new" && p.existingStatus !== "removed");
  const isOn = (p: PersonLine) => choice[p.key] ?? !p.looksLikeHeading;
  const picked = fresh.filter(isOn);
  const tooMany = picked.length > MAX_PEOPLE;

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await importPeople(
        text,
        picked.map((p) => p.key),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const n = res.data?.added ?? 0;
      const arch = res.data?.archived ?? 0;
      const tail = arch > 0 ? ` · ${arch} в архиве — верни в карточке` : "";
      toast(`Добавили ${n} ${pluralRu(n, "человека", "человека", "человек")}${tail}`, "ok");
      setText("");
      setChoice({});
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
            Разобрали {plan.counts.parsed} {pluralRu(plan.counts.parsed, "строку", "строки", "строк")} · добавим {picked.length}
            {plan.counts.exists > 0 && ` · уже в группе ${plan.counts.exists}`}
            {plan.counts.archived > 0 && ` · в архиве ${plan.counts.archived}`}
            {plan.counts.dupe > 0 && ` · повторов ${plan.counts.dupe}`}
            {plan.counts.issues > 0 && ` · не поняли ${plan.counts.issues}`}
          </p>

          {fresh.length > 0 && (
            <Block title={`Добавим ${picked.length} из ${fresh.length}`} icon={<Check className="size-4 text-accent" />}>
              {fresh.map((p) => (
                <AddRow key={p.line} p={p} checked={isOn(p)} onToggle={() => setChoice((c) => ({ ...c, [p.key]: !isOn(p) }))} />
              ))}
            </Block>
          )}

          {archived.length > 0 && (
            <>
              <Block title={`В архиве ${archived.length}`} icon={<Archive className="size-4 text-warn" />}>
                {archived.map((p) => (
                  <ArchivedRow key={p.line} p={p} />
                ))}
              </Block>
              <p className="text-[13px] text-muted">Этих людей когда-то убрали из группы. Импорт их не вернёт — открой карточку и нажми «Вернуть в группу».</p>
            </>
          )}

          {known.length > 0 && (
            <Block title={`Пропустим ${known.length}`} icon={<Users className="size-4" />}>
              {known.map((p) => (
                <SkipRow key={p.line} p={p} />
              ))}
            </Block>
          )}

          {plan.issues.length > 0 && (
            <Block title={`Не разобрали ${plan.issues.length}`} icon={<AlertTriangle className="size-4 text-warn" />}>
              {plan.issues.map((i) => (
                <li key={i.line} className="flex min-h-10 items-center gap-2 border-b border-border px-3 py-2 last:border-0">
                  <Num n={i.line} />
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

      <Button size="lg" className="w-full" onClick={submit} loading={pending} disabled={picked.length === 0 || tooMany}>
        {picked.length > 0 ? `Добавить ${picked.length} ${pluralRu(picked.length, "человека", "человека", "человек")}` : "Добавить"}
      </Button>
    </div>
  );
}
