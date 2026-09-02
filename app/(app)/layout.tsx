import { requireUser } from "@/lib/auth";
import { TabBar } from "@/components/features/tab-bar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <div className="flex-1 pb-safe">{children}</div>
      <TabBar role={user.role} />
    </div>
  );
}
