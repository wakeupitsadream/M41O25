-- Сетка звонков филиала с осени 2026 — шесть пар по 80 минут (docs/ROADMAP.md, «16.11.2026: шесть пар в день»).
-- Группам, у которых в настройках пары только до 4-й и все заканчиваются не позже 15:00, дописываем стандартные
-- 5-ю и 6-ю: «Звонки» у студентов и сетка в подсказке распознавания скана показывают шесть пар сразу после выкладки.
-- Сетки с парами после 15:00, уже с 5-й или 6-й парой, пустые или с нечисловым номером не трогаем — их админ правит
-- сам в Настройках (там же кнопка «Поставить стандартную сетку»).
UPDATE "groups"
SET "slot_times" = "slot_times" || '[{"slot":5,"start":"15:00","end":"16:20"},{"slot":6,"start":"16:30","end":"17:50"}]'::jsonb
WHERE jsonb_typeof("slot_times") = 'array'
  AND jsonb_array_length("slot_times") > 0
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements("groups"."slot_times") AS e
    WHERE CASE WHEN jsonb_typeof(e->'slot') = 'number' THEN (e->>'slot')::numeric >= 5 ELSE true END
       OR e->>'end' > '15:00'
  );
