import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Вход" };

export default async function EnterPage() {
  const user = await getSessionUser();
  if (user) redirect("/s");
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="font-display text-[34px] font-bold leading-[1.05]">
          Расписание, домашка
          <br />и всё по группе
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">Приложение только для своих. Код — в закрепе беседы группы.</p>
      </div>
      <InviteForm />
    </div>
  );
}
