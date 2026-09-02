import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSchedulePayload } from "@/lib/schedule/query";
import { lessonsOn } from "@/lib/schedule/derive";
import { capitalize, fmtDayMonth, fmtWeekday, isIso } from "@/lib/schedule/time";
import { KIND_LABEL } from "@/lib/schedule/types";

export const runtime = "nodejs";

let fontCache: ArrayBuffer | null | undefined;

/** Unbounded (TTF) с Google Fonts для Satori; при недоступности — системный шрифт. */
async function loadFont(): Promise<ArrayBuffer | null> {
  if (fontCache !== undefined) return fontCache;
  try {
    // Без браузерного User-Agent Google отдаёт TTF (Satori понимает TTF/OTF/WOFF, но не WOFF2).
    const css = await fetch("https://fonts.googleapis.com/css2?family=Unbounded:wght@700", {
      headers: { "User-Agent": "curl/8" },
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.text());
    const url = css.match(/url\(([^)]+\.(?:ttf|otf|woff))\)/)?.[1];
    fontCache = url ? await fetch(url, { signal: AbortSignal.timeout(5000) }).then((r) => r.arrayBuffer()) : null;
  } catch {
    fontCache = null;
  }
  return fontCache ?? null;
}

/** PNG-карточка дня 1080×1350 (под сторис и ВК) в фирменном стиле — для кнопки «Поделиться» на экране дня. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!isIso(date)) return NextResponse.json({ error: "date=YYYY-MM-DD" }, { status: 400 });

  const payload = await getSchedulePayload(user.groupId);
  const lessons = lessonsOn(payload.weeks, date).filter((l) => !l.isCancelled);
  const font = await loadFont();
  const family = font ? "Unbounded" : "sans-serif";

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
            <div style={{ fontSize: 30, color: "#9C9CA8", letterSpacing: 2, textTransform: "uppercase" }}>{`${fmtDayMonth(date)} · ${payload.group.shortName}`}</div>
            <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1, marginTop: 12 }}>{capitalize(fmtWeekday(date))}</div>
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>
            <span>Raspis</span>
            <span style={{ color: "#C8FF2E" }}>on</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 64, flex: 1 }}>
          {lessons.length === 0 && <div style={{ fontSize: 48, color: "#9C9CA8" }}>Пар нет 🎉</div>}
          {lessons.slice(0, 7).map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 28, background: "#141419", borderRadius: 28, padding: "26px 32px", border: "1px solid #26262F" }}>
              <div style={{ display: "flex", flexDirection: "column", width: 150 }}>
                <div style={{ fontSize: 40, fontWeight: 700 }}>{l.startsAt}</div>
                <div style={{ fontSize: 26, color: "#62626E" }}>{l.endsAt}</div>
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

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#62626E" }}>
          <div>{lessons.length ? `${lessons.length} ${lessons.length === 1 ? "пара" : lessons.length < 5 ? "пары" : "пар"} · ${lessons[0].startsAt}–${lessons[lessons.length - 1].endsAt}` : ""}</div>
          <div>расписание группы</div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      fonts: font ? [{ name: "Unbounded", data: font, weight: 700, style: "normal" }] : undefined,
      headers: { "Cache-Control": "private, max-age=600" },
    },
  );
}
