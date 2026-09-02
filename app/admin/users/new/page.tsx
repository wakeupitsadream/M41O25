import { requireRole } from "@/lib/auth";
import { createUser } from "@/app/admin/actions/users";
import { UserForm } from "@/components/admin/user-form";
import { Card } from "@/components/ui/card";

export default async function NewUserPage() {
  await requireRole("admin");
  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-bold leading-none">Новый человек</h1>
      <p className="text-[14px] text-muted">Добавь одногруппника — он найдёт себя в списке при входе и задаст PIN.</p>
      <Card>
        <UserForm action={createUser} submitLabel="Добавить" />
      </Card>
    </div>
  );
}
