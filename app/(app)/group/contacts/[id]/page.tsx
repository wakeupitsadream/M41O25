import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { deleteContact, updateContact } from "@/app/(app)/group/actions";
import { SubHeader } from "@/components/group/sub-header";
import { ContactForm } from "@/components/group/contact-form";
import { ConfirmButton } from "@/components/admin/forms";

export const metadata = { title: "Контакт" };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("moderator");
  const { id } = await params;
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.groupId, user.groupId)));
  if (!c) notFound();
  return (
    <>
      <SubHeader title={c.name} subtitle="контакт" back="/group/contacts" backLabel="Контакты" />
      <div className="space-y-4 px-5">
        <ContactForm action={updateContact.bind(null, c.id)} values={c} submitLabel="Сохранить" />
        <ConfirmButton variant="danger" className="w-full" confirmText="Удалить контакт?" action={deleteContact.bind(null, c.id)}>
          Удалить
        </ConfirmButton>
      </div>
    </>
  );
}
