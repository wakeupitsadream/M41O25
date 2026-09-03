import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionUser } from "@/lib/auth";
import { InviteForm } from "./invite-form";
import { ClearLocal } from "@/components/features/clear-local";
import { EnterInstallHint } from "@/components/features/enter-install-hint";

export const metadata = { title: "Вход" };

export default async function EnterPage({ searchParams }: { searchParams: Promise<{ cleared?: string; code?: string }> }) {
  const user = await getSessionUser();
  if (user) redirect("/s");
  // Cookie есть, а сессии нет — чистим её один раз (параметр cleared защищает от петли).
  const { cleared, code } = await searchParams;
  if (!cleared && (await cookies()).get(SESSION_COOKIE)) redirect("/api/auth/clear");
  return (
    <div className="space-y-8">
      <ClearLocal />
      <div className="space-y-3">
        <h1 className="font-display text-[34px] font-bold leading-[1.05]">
          Расписание, домашка
          <br />и всё по группе
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">Приложение только для своих. Код — в закрепе беседы группы.</p>
      </div>
      <EnterInstallHint />
      <InviteForm defaultCode={code?.slice(0, 20).toUpperCase()} />
    </div>
  );
}
