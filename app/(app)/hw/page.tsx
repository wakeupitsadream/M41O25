import { PageHeader, EmptyState } from "@/components/ui/primitives";

export const metadata = { title: "Домашка" };

export default function HomeworkPage() {
  return (
    <>
      <PageHeader title="Домашка" />
      <EmptyState emoji="🎉" title="ДЗ нет. Живём" text="Когда что-то зададут — нажми плюс и запиши за 20 секунд." />
    </>
  );
}
