import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSchedulePayload } from "@/lib/schedule/query";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = await getSchedulePayload(user.groupId, user.id);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}
