import { requireRole } from "@/lib/auth";
import { SubHeader } from "@/components/group/sub-header";
import { TaskForm } from "@/components/group/task-form";

export const metadata = { title: "Задача" };

export default async function NewTaskPage() {
  await requireRole("moderator");
  return (
    <>
      <SubHeader title="Новая задача" back="/group/tasks" backLabel="Задачи" />
      <div className="px-5">
        <TaskForm />
      </div>
    </>
  );
}
