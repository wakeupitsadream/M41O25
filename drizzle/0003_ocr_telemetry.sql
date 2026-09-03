ALTER TABLE "schedule_imports" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "schedule_imports" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "schedule_imports" ADD COLUMN "attempts" integer;