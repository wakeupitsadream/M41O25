/**
 * Константы распознавания без Zod: их читает клиентский черновик (lib/ocr/draft.ts → scan-recognizer), а схемы
 * с валидацией — только сервер. Пока они лежали в schema.ts, Zod целиком уезжал в бандл редактора недели.
 */
export const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayCode = (typeof DAY_CODES)[number];

export const OCR_LESSON_TYPES = ["лекция", "практика", "лаба", "семинар", "консультация", "зачёт", "экзамен", "другое"] as const;
export type OcrLessonType = (typeof OCR_LESSON_TYPES)[number];

export const KIND_FROM_OCR: Record<OcrLessonType, "lecture" | "practice" | "lab" | "consultation" | "credit" | "exam" | "other"> = {
  лекция: "lecture",
  практика: "practice",
  семинар: "practice",
  лаба: "lab",
  консультация: "consultation",
  зачёт: "credit",
  экзамен: "exam",
  другое: "other",
};
