ALTER TABLE "push_subscriptions" ALTER COLUMN "topics" SET DEFAULT '{homework,schedule,news,questions,polls}'::text[];--> statement-breakpoint
-- Новый default получают только новые подписки, поэтому старым тему дописываем руками: иначе тот, кто включил
-- уведомления до этого релиза, не узнает об отмене пары. Пустой массив обходим стороной: снятые все галочки —
-- осознанное «ничего не слать». Для предыдущего деплоя безопасно: незнакомую тему его normalizeTopics отбрасывает.
UPDATE "push_subscriptions" SET "topics" = array_append("topics", 'schedule') WHERE cardinality("topics") > 0 AND NOT ('schedule' = ANY("topics"));--> statement-breakpoint
CREATE INDEX "activity_actor_created_idx" ON "activity" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_entity_idx" ON "activity" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "attachments_uploader_created_idx" ON "attachments" USING btree ("uploaded_by","created_at");