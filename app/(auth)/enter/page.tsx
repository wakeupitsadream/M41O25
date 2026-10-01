import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session-cookie";
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
      {cleared && (
        // Сюда приводит /api/auth/clear: сессию отозвал админ («Выйти везде», сброс PIN, удаление) или она истекла.
        // Без объяснения это выглядит как «сломалось»; черновик ДЗ ClearLocal не трогает — об этом тоже говорим.
        <p className="rounded-lg bg-surface px-3.5 py-3 text-[13px] leading-relaxed text-muted hairline">
          Вход на этом устройстве закончился — сессия истекла или админ её сбросил. Введи код из закрепа беседы и свой PIN; если PIN сбросили — придумаешь новый. Недописанная домашка никуда не делась.
        </p>
      )}
      <InviteForm defaultCode={code?.slice(0, 20).toUpperCase()} />
    </div>
  );
}
