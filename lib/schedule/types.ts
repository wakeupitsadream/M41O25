import type { LessonKind, SlotTime } from "@/lib/db/schema";

export type { LessonKind };

export const KIND_LABEL: Record<LessonKind, string> = {
  lecture: "Лекция",
  practice: "Практика",
  lab: "Лаба",
  exam: "Экзамен",
  credit: "Зачёт",
  consultation: "Консультация",
  other: "",
};

export const PARITY_LABEL = { upper: "Верхняя", lower: "Нижняя" } as const;

export type ScheduleLesson = {
  id: string;
  date: string;
  slot: number;
  startsAt: string;
  endsAt: string;
  title: string;
  subjectId: string | null;
  subjectShort: string | null;
  subjectColor: string | null;
  room: string | null;
  teacherName: string | null;
  kind: LessonKind;
  note: string | null;
  isCancelled: boolean;
  modifiedAfterPublish: boolean;
};

export type ScheduleWeek = {
  id: string;
  startsOn: string;
  parity: "upper" | "lower" | null;
  publishedAt: string | null;
  lessons: ScheduleLesson[];
};

export type ScheduleSemester = {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  sessionStartsOn: string | null;
};

export type SchedulePayload = {
  group: { shortName: string; slotTimes: SlotTime[] };
  semester: ScheduleSemester | null;
  weeks: ScheduleWeek[];
  generatedAt: string;
};
