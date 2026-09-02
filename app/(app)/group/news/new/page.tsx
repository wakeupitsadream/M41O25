import { requireRole } from "@/lib/auth";
import { SubHeader } from "@/components/group/sub-header";
import { NewsForm } from "@/components/group/news-form";

export const metadata = { title: "Новость" };

export default async function NewNewsPage() {
  await requireRole("moderator");
  return (
    <>
      <SubHeader title="Новое объявление" back="/group/news" backLabel="Новости" />
      <div className="px-5">
        <NewsForm />
      </div>
    </>
  );
}
