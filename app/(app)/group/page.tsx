import { PageHeader, EmptyState } from "@/components/ui/primitives";

export const metadata = { title: "Группа" };

export default function GroupPage() {
  return (
    <>
      <PageHeader title="Группа" />
      <EmptyState emoji="🚧" title="Скоро" text="Новости, задачи, опросы, контакты и дни рождения появятся здесь." />
    </>
  );
}
