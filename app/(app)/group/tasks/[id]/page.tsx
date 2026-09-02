import { notFound } from "next/navigation";
import { hasRole, requireUser } from "@/lib/auth";
import { getTask } from "@/lib/group/query";
import { todayIso } from "@/lib/tz";
import { SubHeader } from "@/components/group/sub-header";
import { TaskDetail } from "@/components/group/task-detail";

export const metadata = { title: "Задача" };
export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const task = await getTask(user.groupId, id);
  if (!task) notFound();
  return (
    <>
      <SubHeader title={task.title} subtitle={task.closed ? "закрыта" : "задача"} back="/group/tasks" backLabel="Задачи" />
      <div className="px-5">
        <TaskDetail task={task} me={{ id: user.id, isAdmin: hasRole(user, "admin"), isMod: hasRole(user, "moderator") }} today={todayIso()} />
      </div>
    </>
  );
}
