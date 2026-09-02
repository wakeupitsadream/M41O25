import { hasRole, requireUser } from "@/lib/auth";
import { listQuestions } from "@/lib/group/query";
import { SubHeader } from "@/components/group/sub-header";
import { QuestionsClient } from "@/components/group/questions";

export const metadata = { title: "Анонимные вопросы" };
export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  const user = await requireUser();
  const items = await listQuestions(user.groupId);
  return (
    <>
      <SubHeader title="Анонимно" subtitle="спроси, не палясь" />
      <div className="px-5">
        <QuestionsClient items={items} canAnswer={hasRole(user, "moderator")} isAdmin={hasRole(user, "admin")} />
      </div>
    </>
  );
}
