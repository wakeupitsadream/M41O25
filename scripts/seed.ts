import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { USER_COLORS, firstName, generateInviteSuffix } from "../lib/utils";
import { addDays, format, startOfWeek } from "date-fns";

/**
 * Использование:
 *   npm run db:seed            — группа + админ (для прода; данные из env SEED_*)
 *   npm run db:seed -- --demo  — плюс 20 тестовых студентов, предметы и расписание на две недели
 */
const DEMO = process.argv.includes("--demo");

const INVITE =
  process.env.SEED_INVITE_CODE ??
  (process.argv.includes("--demo") ? "M41-2025" : `${(process.env.SEED_GROUP_NAME ?? "М41О25").replace(/[^A-ZА-Я0-9]/gi, "").slice(0, 3).toUpperCase()}-${generateInviteSuffix()}`);
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Батутин Максим";
const GROUP_NAME = process.env.SEED_GROUP_NAME ?? "М41О25";

const SLOT_TIMES: schema.SlotTime[] = [
  { slot: 1, start: "08:30", end: "10:00" },
  { slot: 2, start: "10:10", end: "11:40" },
  { slot: 3, start: "12:10", end: "13:40" },
  { slot: 4, start: "13:50", end: "15:20" },
  { slot: 5, start: "15:30", end: "17:00" },
  { slot: 6, start: "17:10", end: "18:40" },
];

const DEMO_STUDENTS = [
  "Абрамова Дарья", "Белов Артём", "Волкова Полина", "Гусев Никита", "Дмитриева Алина",
  "Егоров Максим", "Жукова Софья", "Зайцев Кирилл", "Иванова Анастасия", "Козлов Даниил",
  "Лебедева Ксения", "Морозов Иван", "Новикова Виктория", "Орлов Егор", "Павлова Мария",
  "Романов Тимофей", "Смирнова Елизавета", "Тихонов Матвей", "Фёдорова Вероника", "Шестаков Илья",
];

const DEMO_SUBJECTS: Array<{ name: string; short: string; teacher: string; room: string; color: string }> = [
  { name: "Математический анализ", short: "Матан", teacher: "Иванова И.И.", room: "214", color: "#8FA6FF" },
  { name: "Микроэкономика", short: "Микро", teacher: "Петров П.П.", room: "305", color: "#FFD666" },
  { name: "Английский язык", short: "Англ", teacher: "Смирнова А.В.", room: "118", color: "#7CE7A9" },
  { name: "История России", short: "История", teacher: "Кузнецов С.Н.", room: "402", color: "#FF9E7A" },
  { name: "Философия", short: "Философия", teacher: "Орлова Е.М.", room: "310", color: "#C79BFF" },
  { name: "Информатика", short: "Информатика", teacher: "Соколов Д.А.", room: "207", color: "#6EDDF6" },
  { name: "Правоведение", short: "Право", teacher: "Морозова Т.К.", room: "401", color: "#FF8FC8" },
  { name: "Физическая культура", short: "Физра", teacher: "Волков А.А.", room: "Спортзал", color: "#5CD6C0" },
];

// Шаблон недели: день (0=пн) → список [номер пары, индекс предмета, вид]
type Tpl = Array<[number, number, schema.LessonKind]>;
const WEEK_TEMPLATE: Tpl[] = [
  [[1, 0, "lecture"], [2, 0, "practice"], [3, 1, "lecture"]],
  [[2, 2, "practice"], [3, 3, "lecture"], [4, 3, "practice"]],
  [[1, 4, "lecture"], [2, 5, "lab"], [3, 5, "lab"]],
  [[2, 1, "practice"], [3, 6, "lecture"], [4, 7, "practice"]],
  [[1, 0, "practice"], [2, 2, "practice"], [3, 4, "practice"]],
  [[1, 6, "practice"], [2, 1, "lecture"]],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });

  let group = (await db.select().from(schema.groups).where(eq(schema.groups.shortName, GROUP_NAME)))[0];
  if (!group) {
    [group] = await db
      .insert(schema.groups)
      .values({ name: `Группа ${GROUP_NAME}`, shortName: GROUP_NAME, inviteCode: INVITE, slotTimes: SLOT_TIMES })
      .returning();
    console.log(`[seed] группа ${GROUP_NAME} создана, инвайт-код: ${INVITE}`);
  } else {
    console.log(`[seed] группа ${GROUP_NAME} уже есть`);
  }

  const existingUsers = await db.select().from(schema.users).where(eq(schema.users.groupId, group.id));
  if (!existingUsers.some((u) => u.role === "admin")) {
    await db.insert(schema.users).values({
      groupId: group.id,
      fullName: ADMIN_NAME,
      nickname: firstName(ADMIN_NAME),
      avatarEmoji: "🧑‍💻",
      color: USER_COLORS[4],
      role: "admin",
    });
    console.log(`[seed] админ «${ADMIN_NAME}» создан`);
  }

  if (!DEMO) {
    await pool.end();
    return;
  }

  if (existingUsers.length < 5) {
    await db.insert(schema.users).values(
      DEMO_STUDENTS.map((fullName, i) => ({
        groupId: group.id,
        fullName,
        color: USER_COLORS[i % USER_COLORS.length],
        avatarEmoji: ["🦊", "🐼", "🐨", "🦁", "🐯", "🐸", "🐙", "🦄", "🐳", "🦋"][i % 10],
        role: i === 0 ? ("moderator" as const) : ("student" as const),
        birthday: `2006-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
      })),
    );
    console.log(`[seed] ${DEMO_STUDENTS.length} тестовых студентов`);
  }

  let subjects = await db.select().from(schema.subjects).where(eq(schema.subjects.groupId, group.id));
  if (subjects.length === 0) {
    subjects = await db
      .insert(schema.subjects)
      .values(
        DEMO_SUBJECTS.map((s) => ({
          groupId: group.id,
          name: s.name,
          shortName: s.short,
          defaultTeacher: s.teacher,
          defaultRoom: s.room,
          color: s.color,
        })),
      )
      .returning();
    console.log(`[seed] ${subjects.length} предметов`);
  }

  const today = new Date();
  const semStart = format(startOfWeek(new Date(today.getFullYear(), 8, 1), { weekStartsOn: 1 }), "yyyy-MM-dd");
  let semester = (await db.select().from(schema.semesters).where(eq(schema.semesters.groupId, group.id)))[0];
  if (!semester) {
    [semester] = await db
      .insert(schema.semesters)
      .values({
        groupId: group.id,
        title: `Осень ${today.getFullYear()}`,
        startsOn: semStart,
        endsOn: `${today.getFullYear()}-12-27`,
        sessionStartsOn: `${today.getFullYear()}-12-28`,
      })
      .returning();
    console.log(`[seed] семестр «${semester.title}»`);
  }

  const weeksExisting = await db.select().from(schema.weeks).where(eq(schema.weeks.groupId, group.id));
  if (weeksExisting.length === 0) {
    const monday = startOfWeek(today, { weekStartsOn: 1 });
    const plan: Array<{ offset: number; parity: "upper" | "lower"; status: "draft" | "published" }> = [
      { offset: -7, parity: "lower", status: "published" },
      { offset: 0, parity: "upper", status: "published" },
      { offset: 7, parity: "lower", status: "published" },
      { offset: 14, parity: "upper", status: "draft" },
    ];
    for (const p of plan) {
      const startsOn = format(addDays(monday, p.offset), "yyyy-MM-dd");
      const [week] = await db
        .insert(schema.weeks)
        .values({
          groupId: group.id,
          semesterId: semester.id,
          startsOn,
          parity: p.parity,
          status: p.status,
          publishedAt: p.status === "published" ? new Date() : null,
        })
        .returning();
      const rows = WEEK_TEMPLATE.flatMap((day, dayIdx) =>
        day
          .filter(([slot]) => !(p.parity === "lower" && slot === 4))
          .map(([slot, subjIdx, kind]) => {
            const subj = subjects[subjIdx];
            const st = SLOT_TIMES[slot - 1];
            return {
              weekId: week.id,
              groupId: group.id,
              subjectId: subj.id,
              title: subj.name,
              date: format(addDays(monday, p.offset + dayIdx), "yyyy-MM-dd"),
              slot,
              startsAt: st.start,
              endsAt: st.end,
              room: subj.defaultRoom,
              teacherName: subj.defaultTeacher,
              kind,
            };
          }),
      );
      await db.insert(schema.lessons).values(rows);
    }
    console.log(`[seed] ${plan.length} недели расписания`);
  }

  await pool.end();
  console.log("[seed] готово");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
