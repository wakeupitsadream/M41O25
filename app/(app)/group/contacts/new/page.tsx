import { requireRole } from "@/lib/auth";
import { createContact } from "@/app/(app)/group/actions";
import { SubHeader } from "@/components/group/sub-header";
import { ContactForm } from "@/components/group/contact-form";

export const metadata = { title: "Контакт" };

export default async function NewContactPage() {
  await requireRole("moderator");
  return (
    <>
      <SubHeader title="Новый контакт" back="/group/contacts" backLabel="Контакты" />
      <div className="px-5">
        <ContactForm action={createContact} submitLabel="Добавить" />
      </div>
    </>
  );
}
