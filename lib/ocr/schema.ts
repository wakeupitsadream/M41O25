import { z } from "zod";

export const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayCode = (typeof DAY_CODES)[number];

export const ocrLessonSchema = z.object({
  day: z.enum(DAY_CODES),
  slot: z.number().int().min(0).max(10),
  // На печатных листах время бывает «8.30» и «8-30» — принимаем и нормализуем в toDraft.
  time_start: z.string().regex(/^\d{1,2}[:.\-]\d{2}$/).nullable(),
  time_end: z.string().regex(/^\d{1,2}[:.\-]\d{2}$/).nullable(),
  subject: z.string().min(1),
  lesson_type: z.enum(["лекция", "практика", "лаба", "семинар", "консультация", "зачёт", "экзамен", "другое"]).nullable(),
  teacher: z.string().nullable(),
  room: z.string().nullable(),
  week_type: z.enum(["upper", "lower", "both"]),
  uncertain: z.boolean(),
  raw_text: z.string(),
});

export const ocrResultSchema = z.object({
  group_found: z.boolean(),
  group_label_seen: z.string().nullable(),
  week_type: z.enum(["upper", "lower"]).nullable(),
  confidence_notes: z.string(),
  lessons: z.array(ocrLessonSchema),
});

export type OcrLesson = z.infer<typeof ocrLessonSchema>;
export type OcrResult = z.infer<typeof ocrResultSchema>;

/** JSON Schema для response_format (strict): все поля обязательны, nullable там, где данных может не быть. */
export const ocrJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["group_found", "group_label_seen", "week_type", "confidence_notes", "lessons"],
  properties: {
    group_found: { type: "boolean" },
    group_label_seen: { type: ["string", "null"] },
    week_type: { type: ["string", "null"], enum: ["upper", "lower", null] },
    confidence_notes: { type: "string" },
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "slot", "time_start", "time_end", "subject", "lesson_type", "teacher", "room", "week_type", "uncertain", "raw_text"],
        properties: {
          day: { type: "string", enum: [...DAY_CODES] },
          slot: { type: "integer" },
          time_start: { type: ["string", "null"] },
          time_end: { type: ["string", "null"] },
          subject: { type: "string" },
          lesson_type: { type: ["string", "null"], enum: ["лекция", "практика", "лаба", "семинар", "консультация", "зачёт", "экзамен", "другое", null] },
          teacher: { type: ["string", "null"] },
          room: { type: ["string", "null"] },
          week_type: { type: "string", enum: ["upper", "lower", "both"] },
          uncertain: { type: "boolean" },
          raw_text: { type: "string" },
        },
      },
    },
  },
} as const;

export const KIND_FROM_OCR: Record<NonNullable<OcrLesson["lesson_type"]>, "lecture" | "practice" | "lab" | "consultation" | "credit" | "exam" | "other"> = {
  лекция: "lecture",
  практика: "practice",
  семинар: "practice",
  лаба: "lab",
  консультация: "consultation",
  зачёт: "credit",
  экзамен: "exam",
  другое: "other",
};
