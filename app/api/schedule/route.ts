import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSchedulePayload } from "@/lib/schedule/query";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Без параметров — текущий семестр (кешируется офлайн); `?semester=<id>` — окно архивного семестра группы. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const wanted = new URL(req.url).searchParams.get("semester");
  const payload = await getSchedulePayload(user.groupId, user.id, wanted && UUID.test(wanted) ? wanted : null);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}
