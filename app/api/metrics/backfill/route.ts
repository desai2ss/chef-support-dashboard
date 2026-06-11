// One-shot rollup: pulls sessions_v0 rows for [from, to] and upserts into
// daily_metrics. Editor-gated. Used for:
//   - Initial 90-day backfill after schema deploy
//   - Manual re-runs if BQ data backfills late
//   - The Phase 3 nightly cron will hit this with from=yesterday=to
//
// Usage:
//   POST /api/metrics/backfill?from=2026-03-16&to=2026-05-15
//   GET  /api/metrics/backfill?from=2026-03-16&to=2026-05-15  (alias)
//
// Returns: { ok, from, to, rowsScanned, rowsWritten, rowsSkipped, unknownHostnames }

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runRollup } from "@/lib/metrics-rollup";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60; // BQ + 90 days of inserts can take a while

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function handle(req: Request) {
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

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from and to must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (from > to) {
    return NextResponse.json({ error: "from must be ≤ to" }, { status: 400 });
  }

  try {
    const result = await runRollup(from, to);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Rollup failed" },
      { status: 502 }
    );
  }
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
