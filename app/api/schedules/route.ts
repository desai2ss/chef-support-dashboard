import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { sql, eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// List all overrides. Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD to filter range.
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
      .from(schema.scheduleOverrides)
      .where(
        and(
          sql`${schema.scheduleOverrides.date} >= ${from}`,
          sql`${schema.scheduleOverrides.date} <= ${to}`
        )
      );
  } else {
    rows = await db.select().from(schema.scheduleOverrides);
  }
  return NextResponse.json({ overrides: rows });
}

// Upsert a single override. If both robot and total are null, delete the row.
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
  const lineId = String(body.lineId ?? "").trim();
  const date = String(body.date ?? "").trim();
  if (!lineId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "lineId and YYYY-MM-DD date required" },
      { status: 400 }
    );
  }
  const robot =
    body.robot === null || body.robot === undefined ? null : Number(body.robot);
  const total =
    body.total === null || body.total === undefined ? null : Number(body.total);

  if (robot === null && total === null) {
    // No override; delete any existing row.
    await db
      .delete(schema.scheduleOverrides)
      .where(
        and(
          eq(schema.scheduleOverrides.lineId, lineId),
          eq(schema.scheduleOverrides.date, date)
        )
      );
    return NextResponse.json({ ok: true, deleted: true });
  }

  // Upsert (insert or update on conflict).
  const updatedBy = session.user.email ?? null;
  await db
    .insert(schema.scheduleOverrides)
    .values({
      lineId,
      date,
      robot,
      total,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [schema.scheduleOverrides.lineId, schema.scheduleOverrides.date],
      set: {
        robot,
        total,
        updatedBy,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}
