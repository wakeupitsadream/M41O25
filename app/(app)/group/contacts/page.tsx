import Link from "next/link";
import { AtSign, MessageSquare, Pencil, Phone, Plus } from "lucide-react";
import { hasRole, requireUser } from "@/lib/auth";
import { listContacts } from "@/lib/group/query";
import { EmptyState } from "@/components/ui/primitives";
import { SubHeader } from "@/components/group/sub-header";

export const metadata = { title: "Контакты" };
export const dynamic = "force-dynamic";

const KIND_TITLE = { teacher: "Преподаватели", dean: "Деканат и кафедры", other: "Ещё" } as const;

export default async function ContactsPage() {
  const user = await requireUser();
  const list = await listContacts(user.groupId);
  const canEdit = hasRole(user, "moderator");
  const kinds = (["teacher", "dean", "other"] as const).filter((k) => list.some((c) => c.kind === k));

  return (
    <>
      <SubHeader
        title="Контакты"
        subtitle="кому писать и звонить"
        right={
          canEdit ? (
            <Link href="/group/contacts/new" className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-ink active:bg-accent-press">
              <Plus className="size-4" /> Контакт
            </Link>
          ) : undefined
        }
      />
      <div className="space-y-5 px-5">
        {list.length === 0 && <EmptyState emoji="📇" title="Пока пусто" text={canEdit ? "Добавь преподавателей и деканат — то, что они сами дали студентам." : "Староста скоро заполнит."} />}
        {kinds.map((k) => (
          <section key={k} className="space-y-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{KIND_TITLE[k]}</h2>
            <ul className="overflow-hidden rounded-lg bg-surface hairline">
              {list
                .filter((c) => c.kind === k)
                .map((c) => (
                  <li key={c.id} className="border-b border-border p-4 last:border-0">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-[16px] font-bold leading-snug">{c.name}</div>
                        {c.roleOrSubject && <div className="text-[13px] text-muted">{c.roleOrSubject}</div>}
                        {c.note && <div className="mt-1 text-[13px] text-muted">{c.note}</div>}
                      </div>
                      {canEdit && (
                        <Link href={`/group/contacts/${c.id}`} aria-label="Изменить" className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted">
                          <Pencil className="size-3.5" />
                        </Link>
                      )}
                    </div>
                    {(c.phone || c.email || c.messenger) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {c.phone && (
                          <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-medium hairline active:bg-surface-3">
                            <Phone className="size-3.5 text-accent" /> {c.phone}
                          </a>
                        )}
                        {c.email && (
                          <a href={`mailto:${c.email}`} className="flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-medium hairline active:bg-surface-3">
                            <AtSign className="size-3.5 text-accent" /> {c.email}
                          </a>
                        )}
                        {c.messenger && (
                          <span className="flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-medium hairline">
                            <MessageSquare className="size-3.5 text-accent" /> {c.messenger}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
