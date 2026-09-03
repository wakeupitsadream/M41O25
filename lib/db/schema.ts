import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("user_role", ["admin", "moderator", "student"]);
export const userStatusEnum = pgEnum("user_status", ["active", "removed"]);
export const parityEnum = pgEnum("week_parity", ["upper", "lower"]);
export const weekStatusEnum = pgEnum("week_status", ["draft", "published"]);
export const lessonKindEnum = pgEnum("lesson_kind", [
  "lecture",
  "practice",
  "lab",
  "exam",
  "credit",
  "consultation",
  "other",
]);
export const importStatusEnum = pgEnum("import_status", ["uploaded", "recognized", "failed", "applied"]);
export const attachmentEntityEnum = pgEnum("attachment_entity", ["homework", "news", "task", "scan"]);
export const contactKindEnum = pgEnum("contact_kind", ["teacher", "dean", "other"]);
export const reactionEntityEnum = pgEnum("reaction_entity", ["homework", "news", "task"]);

export type SlotTime = { slot: number; start: string; end: string };

export const groups = pgTable("groups", {
  id: id(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  slotTimes: jsonb("slot_times").$type<SlotTime[]>().notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    fullName: text("full_name").notNull(),
    nickname: text("nickname"),
    avatarEmoji: text("avatar_emoji").notNull().default("🙂"),
    color: text("color").notNull(),
    role: roleEnum("role").notNull().default("student"),
    birthday: date("birthday"),
    showHwDone: boolean("show_hw_done").notNull().default(false),
    pinHash: text("pin_hash"),
    pinFailedCount: integer("pin_failed_count").notNull().default(0),
    pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
    status: userStatusEnum("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    feedSeenAt: timestamp("feed_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("users_group_idx").on(t.groupId)],
);

export const deviceSessions = pgTable(
  "device_sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("device_sessions_token_idx").on(t.tokenHash), index("device_sessions_user_idx").on(t.userId)],
);

// Попытки входа (код группы, PIN): лимит по IP и по профилю считается по этой таблице, чистится cron.
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: id(),
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_attempts_key_created_idx").on(t.key, t.createdAt)],
);

export const semesters = pgTable("semesters", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  title: text("title").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  sessionStartsOn: date("session_starts_on"),
  createdAt: createdAt(),
});

export const subjects = pgTable(
  "subjects",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    name: text("name").notNull(),
    shortName: text("short_name"),
    color: text("color"),
    defaultTeacher: text("default_teacher"),
    defaultRoom: text("default_room"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("subjects_group_idx").on(t.groupId)],
);

export const weeks = pgTable(
  "weeks",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    semesterId: uuid("semester_id").references(() => semesters.id, { onDelete: "set null" }),
    startsOn: date("starts_on").notNull(),
    parity: parityEnum("parity"),
    status: weekStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("weeks_group_start_idx").on(t.groupId, t.startsOn)],
);

export const lessons = pgTable(
  "lessons",
  {
    id: id(),
    weekId: uuid("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    subjectId: uuid("subject_id").references(() => subjects.id),
    title: text("title").notNull(),
    date: date("date").notNull(),
    slot: integer("slot").notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
    room: text("room"),
    teacherName: text("teacher_name"),
    kind: lessonKindEnum("kind").notNull().default("other"),
    note: text("note"),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    modifiedAfterPublish: boolean("modified_after_publish").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lessons_week_idx").on(t.weekId), index("lessons_group_date_idx").on(t.groupId, t.date)],
);

export const scheduleImports = pgTable("schedule_imports", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  weekId: uuid("week_id").references(() => weeks.id, { onDelete: "set null" }),
  scanKeys: jsonb("scan_keys").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  model: text("model"),
  rawJson: jsonb("raw_json"),
  status: importStatusEnum("status").notNull().default("uploaded"),
  error: text("error"),
  createdAt: createdAt(),
});

export const homework = pgTable(
  "homework",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    subjectId: uuid("subject_id").references(() => subjects.id),
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
    title: text("title"),
    body: text("body").notNull(),
    dueDate: date("due_date").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    duplicateOfId: uuid("duplicate_of_id"),
    duplicateMarkedBy: uuid("duplicate_marked_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("homework_group_due_idx").on(t.groupId, t.dueDate), index("homework_author_created_idx").on(t.createdBy, t.createdAt)],
);

export const hwEdits = pgTable(
  "hw_edits",
  {
    id: id(),
    homeworkId: uuid("homework_id")
      .notNull()
      .references(() => homework.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id),
    text: text("text").notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("hw_edits_hw_idx").on(t.homeworkId)],
);

export const hwDone = pgTable(
  "hw_done",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    homeworkId: uuid("homework_id")
      .notNull()
      .references(() => homework.id, { onDelete: "cascade" }),
    doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.homeworkId] })],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    homeworkId: uuid("homework_id")
      .notNull()
      .references(() => homework.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("comments_hw_idx").on(t.homeworkId), index("comments_author_created_idx").on(t.authorId, t.createdAt)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    entityType: attachmentEntityEnum("entity_type").notNull(),
    entityId: uuid("entity_id"),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_entity_idx").on(t.entityType, t.entityId)],
);

export const news = pgTable(
  "news",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    authorId: uuid("author_id").notNull().references(() => users.id),
    title: text("title"),
    body: text("body").notNull(),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("news_group_created_idx").on(t.groupId, t.createdAt)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: date("due_date"),
    trackChecks: boolean("track_checks").notNull().default(true),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("tasks_group_idx").on(t.groupId)],
);

export const taskChecks = pgTable(
  "task_checks",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    checkedBy: uuid("checked_by").notNull().references(() => users.id),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })],
);

export const polls = pgTable(
  "polls",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    question: text("question").notNull(),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    isMulti: boolean("is_multi").notNull().default(false),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("polls_group_idx").on(t.groupId)],
);

export const pollOptions = pgTable(
  "poll_options",
  {
    id: id(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("poll_options_poll_idx").on(t.pollId)],
);

export const pollVotes = pgTable(
  "poll_votes",
  {
    pollId: uuid("poll_id")
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    optionId: uuid("option_id")
      .notNull()
      .references(() => pollOptions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.pollId, t.optionId, t.userId] }), index("poll_votes_poll_idx").on(t.pollId)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    kind: contactKindEnum("kind").notNull().default("teacher"),
    name: text("name").notNull(),
    roleOrSubject: text("role_or_subject"),
    phone: text("phone"),
    email: text("email"),
    messenger: text("messenger"),
    note: text("note"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("contacts_group_idx").on(t.groupId)],
);

// Автора у анонимного вопроса нет — ни колонки, ни лога. Время округляется до часа при записи.
export const anonQuestions = pgTable(
  "anon_questions",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    body: text("body").notNull(),
    answerBody: text("answer_body"),
    answeredBy: uuid("answered_by").references(() => users.id),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("anon_questions_group_idx").on(t.groupId, t.createdAt)],
);

// Антиспам анонимных вопросов: ключ = HMAC(user_id, pepper), связи с текстом вопроса нет.
export const anonQuota = pgTable(
  "anon_quota",
  {
    keyHash: text("key_hash").notNull(),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.keyHash, t.day] })],
);

export const reactions = pgTable(
  "reactions",
  {
    entityType: reactionEntityEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id),
    emoji: text("emoji").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.entityType, t.entityId, t.userId, t.emoji] })],
);

export const activity = pgTable(
  "activity",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    actorId: uuid("actor_id").references(() => users.id),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("activity_group_created_idx").on(t.groupId, t.createdAt)],
);

export const usersRelations = relations(users, ({ one }) => ({
  group: one(groups, { fields: [users.groupId], references: [groups.id] }),
}));

export const weeksRelations = relations(weeks, ({ many, one }) => ({
  lessons: many(lessons),
  semester: one(semesters, { fields: [weeks.semesterId], references: [semesters.id] }),
}));

export const lessonsRelations = relations(lessons, ({ one }) => ({
  week: one(weeks, { fields: [lessons.weekId], references: [weeks.id] }),
  subject: one(subjects, { fields: [lessons.subjectId], references: [subjects.id] }),
}));

export const homeworkRelations = relations(homework, ({ one, many }) => ({
  author: one(users, { fields: [homework.createdBy], references: [users.id] }),
  subject: one(subjects, { fields: [homework.subjectId], references: [subjects.id] }),
  edits: many(hwEdits),
  comments: many(comments),
}));

export const hwEditsRelations = relations(hwEdits, ({ one }) => ({
  homework: one(homework, { fields: [hwEdits.homeworkId], references: [homework.id] }),
  author: one(users, { fields: [hwEdits.authorId], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  homework: one(homework, { fields: [comments.homeworkId], references: [homework.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const pollsRelations = relations(polls, ({ many, one }) => ({
  options: many(pollOptions),
  votes: many(pollVotes),
  author: one(users, { fields: [polls.createdBy], references: [users.id] }),
}));

export const pollOptionsRelations = relations(pollOptions, ({ one }) => ({
  poll: one(polls, { fields: [pollOptions.pollId], references: [polls.id] }),
}));

export const pollVotesRelations = relations(pollVotes, ({ one }) => ({
  poll: one(polls, { fields: [pollVotes.pollId], references: [polls.id] }),
}));

export const tasksRelations = relations(tasks, ({ many, one }) => ({
  checks: many(taskChecks),
  author: one(users, { fields: [tasks.createdBy], references: [users.id] }),
}));

export const taskChecksRelations = relations(taskChecks, ({ one }) => ({
  task: one(tasks, { fields: [taskChecks.taskId], references: [tasks.id] }),
}));

export const newsRelations = relations(news, ({ one }) => ({
  author: one(users, { fields: [news.authorId], references: [users.id] }),
}));

export type Group = typeof groups.$inferSelect;
export type User = typeof users.$inferSelect;
export type Semester = typeof semesters.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type Week = typeof weeks.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Homework = typeof homework.$inferSelect;
export type LessonKind = (typeof lessonKindEnum.enumValues)[number];
export type Role = (typeof roleEnum.enumValues)[number];
