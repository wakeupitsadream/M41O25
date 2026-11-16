-- Пробный период помощника сокращён с 7 до 3 дней (решение владельца 16.11.2026). Умолчание в коде уже 3
-- (lib/assistant/settings.ts); здесь — группы, у которых неделя успела сохраниться в настройках явно. Другие
-- значения (0 — без триала, или выбранное админом число) не трогаем. Уже начатые триалы живут до своей даты.
UPDATE "groups"
SET "assistant_settings" = jsonb_set("assistant_settings", '{trialDays}', '3'::jsonb)
WHERE "assistant_settings"->'trialDays' = '7'::jsonb;
