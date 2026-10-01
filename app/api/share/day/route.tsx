import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { lessons, subjects, weeks } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { capitalize, fmtDayMonth, fmtWeekday, isIso } from "@/lib/schedule/time";
import { KIND_LABEL } from "@/lib/schedule/types";
import { UNBOUNDED_BOLD_B64 } from "@/lib/fonts/unbounded-bold";

export const runtime = "nodejs";

// Шрифт лежит в репозитории (base64): никаких походов в Google Fonts на холодном старте.
const FONT_BYTES = Buffer.from(UNBOUNDED_BOLD_B64, "base64");
const FONT: ArrayBuffer = FONT_BYTES.buffer.slice(FONT_BYTES.byteOffset, FONT_BYTES.byteOffset + FONT_BYTES.byteLength) as ArrayBuffer;

/** PNG-карточка дня 1080×1350 (под сторис и ВК) в фирменном стиле — для кнопки «Поделиться» на экране дня. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!isIso(date)) return NextResponse.json({ error: "date=YYYY-MM-DD" }, { status: 400 });

  // Пары одного дня прямо из базы, а не getSchedulePayload: тот собирает весь семестр с ДЗ за пять запросов ради одной
  // карточки (ревью PERF-06). Как и в payload, видны только пары опубликованных недель; отменённые на карточку не идут.
  const rows = await db
    .select({ id: lessons.id, startsAt: lessons.startsAt, endsAt: lessons.endsAt, title: lessons.title, kind: lessons.kind, room: lessons.room, teacherName: lessons.teacherName, subjectColor: subjects.color })
    .from(lessons)
    .innerJoin(weeks, and(eq(weeks.id, lessons.weekId), eq(weeks.status, "published")))
    .leftJoin(subjects, eq(subjects.id, lessons.subjectId))
    .where(and(eq(lessons.groupId, user.groupId), eq(lessons.date, date), eq(lessons.isCancelled, false)))
    .orderBy(asc(lessons.slot), asc(lessons.startsAt));
  const day = rows.map((l) => ({ ...l, startsAt: l.startsAt.slice(0, 5), endsAt: l.endsAt.slice(0, 5) }));
  const family = "Unbounded";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(180deg, #0A0A0E 0%, #101016 100%)",
          color: "#F4F4F6",
          padding: 72,
          fontFamily: family,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 30, color: "#9C9CA8", letterSpacing: 2, textTransform: "uppercase" }}>{`${fmtDayMonth(date)} · ${user.group.shortName}`}</div>
            <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1, marginTop: 12 }}>{capitalize(fmtWeekday(date))}</div>
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>
            <span>Raspis</span>
            <span style={{ color: "#C8FF2E" }}>on</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 64, flex: 1 }}>
          {day.length === 0 && <div style={{ fontSize: 48, color: "#9C9CA8" }}>Пар нет 🎉</div>}
          {day.slice(0, 7).map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 28, background: "#141419", borderRadius: 28, padding: "26px 32px", border: "1px solid #26262F" }}>
              <div style={{ display: "flex", flexDirection: "column", width: 150 }}>
                <div style={{ fontSize: 40, fontWeight: 700 }}>{l.startsAt}</div>
                <div style={{ fontSize: 26, color: "#82828E" }}>{l.endsAt}</div>
              </div>
              <div style={{ width: 8, height: 88, borderRadius: 4, background: l.subjectColor ?? "#9C9CA8" }} />
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.15 }}>{l.title}</div>
                <div style={{ fontSize: 26, color: "#9C9CA8", marginTop: 8 }}>
                  {[KIND_LABEL[l.kind], l.room && `ауд. ${l.room}`, l.teacherName].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#82828E" }}>
          <div>{day.length ? `${day.length} ${day.length === 1 ? "пара" : day.length < 5 ? "пары" : "пар"} · ${day[0].startsAt}–${day[day.length - 1].endsAt}` : ""}</div>
          <div>расписание группы</div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      fonts: [{ name: "Unbounded", data: FONT, weight: 700, style: "normal" }],
      headers: { "Cache-Control": "private, max-age=600" },
    },
  );
}
