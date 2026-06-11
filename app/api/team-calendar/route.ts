// Shared team-calendar storage. Replaces the old localStorage-only calendar
// so notes (PTO / on-call / site visits / etc.) are visible to everyone.
//
//   GET  /api/team-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
//        → { entries: [{memberId, date, note, updatedBy, updatedAt}, …] }
//
//   POST /api/team-calendar
//        body: { memberId, date, note }   note="" deletes the row
//        → { ok: true }
//
// Editor-only writes (mirrors /api/schedules pattern).

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { sql, eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let rows;
  if (from && to) {
    rows = await db
      .select()
      .from(schema.teamCalendar)
      .where(
        and(
          sql`${schema.teamCalendar.date} >= ${from}`,
          sql`${schema.teamCalendar.date} <= ${to}`
        )
      );
  } else {
    rows = await db.select().from(schema.teamCalendar);
  }
  return NextResponse.json({ entries: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // @ts-expect-error session augmented in auth.ts
  if (!session.user.isEditor) {
    return NextResponse.json({ error: "forbidden — read-only" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const memberId = String(body.memberId ?? "").trim();
  const date = String(body.date ?? "").trim();
  const note = String(body.note ?? "").trim();
  if (!memberId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "memberId and YYYY-MM-DD date required" },
      { status: 400 }
    );
  }

  // Empty note → delete row.
  if (!note) {
    await db
      .delete(schema.teamCalendar)
      .where(
        and(
          eq(schema.teamCalendar.memberId, memberId),
          eq(schema.teamCalendar.date, date)
        )
      );
    return NextResponse.json({ ok: true, deleted: true });
  }

  const updatedBy = session.user.email ?? null;
  await db
    .insert(schema.teamCalendar)
    .values({ memberId, date, note, updatedBy })
    .onConflictDoUpdate({
      target: [schema.teamCalendar.memberId, schema.teamCalendar.date],
      set: { note, updatedBy, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}
