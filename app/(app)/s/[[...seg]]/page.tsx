import { PageHeader, EmptyState } from "@/components/ui/primitives";

export const metadata = { title: "Расписание" };

export default function SchedulePage() {
  return (
    <>
      <PageHeader title="Расписание" />
      <EmptyState emoji="📅" title="Скоро" text="Неделя, день, семестр." />
    </>
  );
}
