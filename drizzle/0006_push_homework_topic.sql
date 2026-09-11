ALTER TABLE "push_subscriptions" ALTER COLUMN "topics" SET DEFAULT '{homework,news,questions,polls}'::text[];--> statement-breakpoint
-- Новый default получают только новые подписки, поэтому старым тему дописываем руками: иначе тот, кто включил
-- уведомления до этого релиза, никогда не увидит пуш о домашке и не поймёт, почему у соседа он есть.
-- Пустой массив при этом обходим стороной: снятые все галочки — это осознанное «ничего не слать», и дописать
-- туда домашку значило бы после деплоя снова разбудить того, кто добивался тишины.
-- Для предыдущего деплоя это безопасно: незнакомую тему его normalizeTopics просто отбрасывает (lib/push/topics.ts).
UPDATE "push_subscriptions" SET "topics" = array_append("topics", 'homework') WHERE cardinality("topics") > 0 AND NOT ('homework' = ANY("topics"));
