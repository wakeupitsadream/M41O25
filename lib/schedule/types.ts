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

/** Короткая запись ДЗ для экрана дня («К этому дню», счётчик на паре). Едет в офлайн-кеш вместе с расписанием. */
export type ScheduleHomework = {
  id: string;
  dueDate: string;
  lessonId: string | null;
  subjectId: string | null;
  subjectShort: string | null;
  subjectColor: string | null;
  title: string | null;
  /** Первые ~140 символов задания одной строкой. */
  text: string;
  done: boolean;
};

export type SchedulePayload = {
  group: { shortName: string; slotTimes: SlotTime[] };
  semester: ScheduleSemester | null;
  weeks: ScheduleWeek[];
  /** Необязательное: кеш в localStorage и в service worker от прежних версий этого поля не имеет — читать через `?? []`. */
  homework?: ScheduleHomework[];
  generatedAt: string;
};
