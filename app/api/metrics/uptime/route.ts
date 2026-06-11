// POST /api/metrics/uptime
//
// Bulk-set uptime_pct for a list of (sn, date) cells. Editor-only.
// When uptime_pct < 100, a Pylon ticket number is REQUIRED and is validated
// against the Pylon API before any write happens. If validation fails, no
// rows are touched.
//
// Body:
//   {
//     cells: [{ sn: number, date: "YYYY-MM-DD" }, ...],
//     uptimePct: number (0..100),
//     pylonTicket: string | null,  // required if uptimePct < 100
//     note: string | null,
//   }
//
// Response:
//   { ok: true, rowsAffected: N, pylonTicketValid: true|false, ticketTitle: "..." }

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { sql, and, eq } from "drizzle-orm";
import { fetchRawIssueByNumber } from "@/lib/pylon";
import { ROBOTS } from "@/lib/fleet-config";

// SN → site lookup for inserts (rows that don't yet exist from BQ rollup).
const SN_TO_SITE = new Map(ROBOTS.map((r) => [r.sn, r.site]));

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // @ts-expect-error session augmented in auth.ts
  if (!session.user.isEditor) {
    return NextResponse.json(
      { error: "forbidden — editors only" },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const cells: { sn: number; date: string }[] = Array.isArray(body.cells)
    ? body.cells
    : [];
  const uptimePct = Number(body.uptimePct);
  const pylonTicket: string | null =
    body.pylonTicket === undefined || body.pylonTicket === null
      ? null
      : String(body.pylonTicket).trim() || null;
  const note: string | null =
    body.note === undefined || body.note === null
      ? null
      : String(body.note).trim() || null;

  // ---- Validation ----
  if (cells.length === 0) {
    return NextResponse.json(
      { error: "cells array must be non-empty" },
      { status: 400 }
    );
  }
  if (cells.length > 500) {
    return NextResponse.json(
      { error: "max 500 cells per request" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(uptimePct) || uptimePct < 0 || uptimePct > 100) {
    return NextResponse.json(
      { error: "uptimePct must be a number between 0 and 100" },
      { status: 400 }
    );
  }
  for (const c of cells) {
    if (!Number.isFinite(c.sn) || c.sn <= 0) {
      return NextResponse.json(
        { error: `invalid SN in cells: ${JSON.stringify(c)}` },
        { status: 400 }
      );
    }
    if (typeof c.date !== "string" || !DATE_RE.test(c.date)) {
      return NextResponse.json(
        { error: `invalid date in cells (need YYYY-MM-DD): ${JSON.stringify(c)}` },
        { status: 400 }
      );
    }
  }
  if (uptimePct < 100 && !pylonTicket) {
    return NextResponse.json(
      {
        error:
          "pylonTicket is required when uptimePct < 100 — every downtime entry must link to a Pylon ticket",
      },
      { status: 400 }
    );
  }

  // ---- Pylon ticket validation ----
  let ticketTitle: string | null = null;
  if (pylonTicket) {
    try {
      const issue = await fetchRawIssueByNumber(pylonTicket);
      if (!issue || (!issue.number && !issue.id)) {
        return NextResponse.json(
          {
            error: `Pylon ticket #${pylonTicket} could not be verified (empty response from Pylon)`,
          },
          { status: 400 }
        );
      }
      ticketTitle = String(issue.title ?? issue.subject ?? "").slice(0, 200);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        return NextResponse.json(
          {
            error: `Pylon ticket #${pylonTicket} not found. Double-check the number.`,
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: `Pylon validation failed: ${msg.slice(0, 200)}` },
        { status: 502 }
      );
    }
  }

  // ---- Upsert ----
  const updatedBy = session.user.email ?? null;
  let rowsAffected = 0;

  // Chunk in batches of 100 just in case Drizzle complains about parameter count.
  const CHUNK = 100;
  for (let i = 0; i < cells.length; i += CHUNK) {
    const batch = cells.slice(i, i + CHUNK);
    const values = batch.map((c) => ({
      sn: c.sn,
      date: c.date,
      site: SN_TO_SITE.get(c.sn) ?? "Unknown",
      uptimePct,
      uptimePylonTicket: pylonTicket,
      uptimeNote: note,
      updatedBy,
    }));

    // On insert (no prior daily_metrics row for this sn/date), site is unknown
    // — set it to a placeholder and the next backfill will fix it. In
    // practice, a row should already exist for any (sn, date) that has BQ
    // data, so the conflict path is the common one.
    await db
      .insert(schema.dailyMetrics)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.dailyMetrics.sn, schema.dailyMetrics.date],
        set: {
          uptimePct: sql`excluded.uptime_pct`,
          uptimePylonTicket: sql`excluded.uptime_pylon_ticket`,
          uptimeNote: sql`excluded.uptime_note`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: sql`now()`,
        },
      });
    rowsAffected += batch.length;
  }

  return NextResponse.json({
    ok: true,
    rowsAffected,
    pylonTicketValid: !!pylonTicket,
    ticketTitle,
  });
}
