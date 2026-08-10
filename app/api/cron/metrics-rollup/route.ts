// Vercel-cron triggered nightly rollup.
//
// Schedule (see vercel.json): daily at 12:00 UTC = 5am PT / 8am ET. By that
// time every customer's 2am local production-day boundary has passed, so
// "yesterday" in every site's timezone is finalized in BigQuery.
//
// Window: re-rolls the last 3 days. The upsert is idempotent, so this
// catches any late-arriving data (e.g. a robot that lost connectivity and
// dumped its backlog after a few hours) without needing a separate
// catch-up job.
//
// Auth: Vercel attaches `Authorization: Bearer ${CRON_SECRET}` when the
// cron triggers this endpoint. The same secret must be set on Vercel
// Settings → Environment Variables.

import { NextResponse } from "next/server";
import { runRollup, RollupResult } from "@/lib/metrics-rollup";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// Roll up the last 7 days on every run. Wider than needed (yesterday would
// suffice) so an occasional missed run auto-heals — the next cron will
// re-do the previous week. Upserts are idempotent, so this doesn't disturb
// manual uptime entries.
const ROLLUP_DAYS = 7;

function fmtUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured → reject all requests. Forces explicit setup.
    return false;
  }
  const header = req.headers.get("authorization") ?? "";
  // Vercel cron sends: "Authorization: Bearer <CRON_SECRET>"
  return header === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      {
        error:
          "unauthorized — set CRON_SECRET in Vercel env and pass Authorization: Bearer <secret>",
      },
      { status: 401 }
    );
  }

  // Roll up the last ROLLUP_DAYS days in UTC. We re-upsert to be safe against
  // late-arriving BQ data; the rollup writes don't disturb manual uptime
  // entries (those are excluded from the ON CONFLICT SET clause).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - (ROLLUP_DAYS - 1));

  try {
    const result: RollupResult = await runRollup(
      fmtUtcDate(from),
      fmtUtcDate(today)
    );
    // Log to Vercel's function log for observability. Shows up in Vercel →
    // your project → Deployments → latest → Logs, filtered by this path.
    // eslint-disable-next-line no-console
    console.log(
      `[cron/metrics-rollup] OK ${result.from}..${result.to} — scanned=${result.rowsScanned} written=${result.rowsWritten} skipped=${result.rowsSkipped}${result.unknownHostnames.length ? ` unknown=${result.unknownHostnames.join(",")}` : ""}`
    );
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      window: { from: result.from, to: result.to },
      ...result,
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    // eslint-disable-next-line no-console
    console.error(`[cron/metrics-rollup] FAIL:`, msg);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        stack: e?.stack ? String(e.stack).slice(0, 800) : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
