import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { PeopleImport } from "@/components/admin/people-import";

export default async function ImportPeoplePage() {
  const admin = await requireRole("admin");
  // Сравниваем и с удалёнными: заводить второго такого же человека не надо, старого лучше вернуть из архива.
  const existing = await db
    .select({ id: users.id, fullName: users.fullName, status: users.status })
    .from(users)
    .where(eq(users.groupId, admin.groupId))
    .orderBy(asc(users.fullName));

  return (
    <div className="space-y-4">
      <Link href="/admin/users" className="-ml-2 inline-flex h-10 items-center gap-1 rounded-full pl-2 pr-3.5 text-[15px] font-medium text-muted active:bg-surface-2">
        <ChevronLeft className="size-5" /> Люди
      </Link>
      <h1 className="font-display text-[28px] font-bold leading-none">Добавить списком</h1>
      <p className="text-[14px] leading-relaxed text-muted">
        Вставь список из беседы — по человеку в строке. Нумерация и лишние пробелы не мешают. Через табуляцию или « — » можно дописать день рождения:
        07.03.2006, 07.03 или 2006-03-07. Роль у всех «студент», цвет и 🙂 подставим сами — потом поправишь в карточке.
        Перед добавлением проверь галочки: заведём только отмеченные строки.
      </p>
      <PeopleImport existing={existing} />
    </div>
  );
}
