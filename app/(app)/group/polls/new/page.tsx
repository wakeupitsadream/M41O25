import { requireUser } from "@/lib/auth";
import { SubHeader } from "@/components/group/sub-header";
import { PollForm } from "@/components/group/poll-form";

export const metadata = { title: "Новый опрос" };

export default async function NewPollPage() {
  await requireUser();
  return (
    <>
      <SubHeader title="Новый опрос" back="/group/polls" backLabel="Опросы" />
      <div className="px-5">
        <PollForm />
      </div>
    </>
  );
}
