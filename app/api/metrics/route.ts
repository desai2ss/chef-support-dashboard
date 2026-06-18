// GET /api/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&grain=day|week|month&site=Café%20Spice
//
// Returns:
//   {
//     ok: true,
//     grain,
//     from, to,
//     rows: [
//       { bucket, site, util_pct_avg, uptime_pct_avg, servings_sum, robots_count }
//     ],
//     // Optional: per-robot daily detail when grain=day and a single site is selected
//     daily: [{ sn, date, util_pct, uptime_pct, servings, uptime_pylon_ticket, uptime_note }]
//   }
//
// `bucket` is:
//   - YYYY-MM-DD when grain=day
//   - YYYY-Www  (ISO week) when grain=week
//   - YYYY-MM   when grain=month

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { sql, and, gte, lte, eq, notInArray } from "drizzle-orm";
import { SITES } from "@/lib/sites-config";

// Sites that should never appear in Metrics output even if rows exist in DB.
const EXCLUDED_SITES = SITES.filter((s) => s.excludeFromMetrics).map(
  (s) => s.name
);

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_GRAINS = new Set(["day", "week", "month"]);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const grain = (url.searchParams.get("grain") ?? "day").toLowerCase();
  const siteFilter = url.searchParams.get("site");

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from and to must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (!VALID_GRAINS.has(grain)) {
    return NextResponse.json(
      { error: "grain must be one of: day, week, month" },
      { status: 400 }
    );
  }

  // Two-step bucket expression (operates on per_day CTE.date column).
  // - day:    bucket = date
  // - week:   bucket = "YYYY-W##" ISO week
  // - month:  bucket = "YYYY-MM"
  const bucketExpr =
    grain === "day"
      ? sql`date`
      : grain === "week"
        ? sql`to_char(to_date(date, 'YYYY-MM-DD'), 'IYYY-"W"IW')`
        : sql`to_char(to_date(date, 'YYYY-MM-DD'), 'YYYY-MM')`;

  // Excluded-site early return
  if (siteFilter && EXCLUDED_SITES.includes(siteFilter)) {
    return NextResponse.json({
      ok: true,
      grain,
      from,
      to,
      site: siteFilter,
      rows: [],
      daily: [],
      excluded: true,
    });
  }

  // Inner WHERE for per_day CTE
  const innerWhere = [
    sql`date BETWEEN ${from} AND ${to}`,
  ];
  if (siteFilter) {
    innerWhere.push(sql`site = ${siteFilter}`);
  } else if (EXCLUDED_SITES.length > 0) {
    innerWhere.push(
      sql`site NOT IN (${sql.join(
        EXCLUDED_SITES.map((s) => sql`${s}`),
        sql`, `
      )})`
    );
  }
  const whereSql = sql.join(innerWhere, sql` AND `);

  // Also build the WHERE for the per-robot drilldown (uses Drizzle columns).
  const driftWhere = [
    gte(schema.dailyMetrics.date, from),
    lte(schema.dailyMetrics.date, to),
  ];
  if (siteFilter) {
    driftWhere.push(eq(schema.dailyMetrics.site, siteFilter));
  } else if (EXCLUDED_SITES.length > 0) {
    driftWhere.push(notInArray(schema.dailyMetrics.site, EXCLUDED_SITES));
  }

  try {
    // Two-step rollup: first average per (date, site), then aggregate over
    // the bucket. This makes weekly = mean of daily means (the intuitive
    // "average day in this period") rather than a row-weighted average that
    // overweights days with more robot reports.
    const result: any = await db.execute(sql`
      WITH per_day AS (
        SELECT
          date,
          site,
          AVG(util_pct)::real      AS daily_util,
          AVG(uptime_pct)::real    AS daily_uptime,
          COALESCE(SUM(servings), 0)::bigint AS daily_servings,
          COUNT(DISTINCT sn)       AS daily_robots
        FROM daily_metrics
        WHERE ${whereSql}
        GROUP BY date, site
      )
      SELECT
        ${bucketExpr}                        AS bucket,
        site,
        AVG(daily_util)::real                AS util_pct_avg,
        AVG(daily_uptime)::real              AS uptime_pct_avg,
        COALESCE(SUM(daily_servings), 0)::bigint AS servings_sum,
        MAX(daily_robots)                    AS robots_count
      FROM per_day
      GROUP BY bucket, site
      ORDER BY bucket, site
    `);
    const rawRows: any[] = Array.isArray(result?.rows)
      ? result.rows
      : Array.isArray(result)
        ? result
        : [];
    const rollup = rawRows.map((r) => ({
      bucket: String(r.bucket),
      site: String(r.site),
      utilPctAvg:
        r.util_pct_avg === null || r.util_pct_avg === undefined
          ? null
          : Number(r.util_pct_avg),
      uptimePctAvg:
        r.uptime_pct_avg === null || r.uptime_pct_avg === undefined
          ? null
          : Number(r.uptime_pct_avg),
      servingsSum: Number(r.servings_sum ?? 0),
      robotsCount: Number(r.robots_count ?? 0),
    }));

    // If grain=day AND a site is selected, also return per-robot daily rows
    // for the drilldown table / cell editor.
    let daily: any[] = [];
    if (grain === "day" && siteFilter) {
      daily = await db
        .select({
          sn: schema.dailyMetrics.sn,
          date: schema.dailyMetrics.date,
          site: schema.dailyMetrics.site,
          utilPct: schema.dailyMetrics.utilPct,
          productionHours: schema.dailyMetrics.productionHours,
          uptimePct: schema.dailyMetrics.uptimePct,
          servings: schema.dailyMetrics.servings,
          uptimePylonTicket: schema.dailyMetrics.uptimePylonTicket,
          uptimeNote: schema.dailyMetrics.uptimeNote,
        })
        .from(schema.dailyMetrics)
        .where(and(...driftWhere))
        .orderBy(schema.dailyMetrics.date, schema.dailyMetrics.sn);
    }

    return NextResponse.json({
      ok: true,
      grain,
      from,
      to,
      site: siteFilter ?? null,
      rows: rollup,
      daily,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Query failed" },
      { status: 500 }
    );
  }
}
