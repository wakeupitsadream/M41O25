/**
 * Виды уведомлений. Хранятся строками в push_subscriptions.topics: добавить новый вид можно без миграции,
 * а незнакомое значение в массиве просто игнорируется (старое устройство не сломает новую сборку).
 */
export const PUSH_TOPICS = ["news", "questions", "polls"] as const;

export type PushTopic = (typeof PUSH_TOPICS)[number];

/** По умолчанию включено всё: человек нажал «Уведомления» — значит хочет знать о жизни группы. */
export const DEFAULT_TOPICS: PushTopic[] = [...PUSH_TOPICS];

export const TOPIC_LABELS: Record<PushTopic, string> = {
  news: "Новости",
  questions: "Анонимные вопросы",
  polls: "Опросы",
};

/** Из того, что пришло с клиента или лежит в базе, — только известные темы, без повторов и в стабильном порядке. */
export const normalizeTopics = (input: readonly unknown[] | null | undefined): PushTopic[] => {
  if (!input) return [];
  return PUSH_TOPICS.filter((t) => input.includes(t));
};
