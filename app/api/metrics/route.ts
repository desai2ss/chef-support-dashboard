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

// Build a SQL VALUES clause containing every (site, scheduled_dow) tuple
// from the SITES config. Lets us CROSS JOIN against a date_range to
// generate the full grid of "days a site should have data on" — even if no
// daily_metrics row exists for that (site, date).
//
// The returned fragment is a *bare* parenthesized expression — the outer
// query is expected to provide the AS alias (e.g. `AS ss(site, dow)`).
function buildSiteScheduleValuesSql(siteFilter: string | null): string {
  const safeName = (s: string) => s.replace(/'/g, "''");
  const eligible = SITES.filter(
    (s) => !s.excludeFromMetrics && (!siteFilter || s.name === siteFilter)
  );
  const tuples = eligible.flatMap((s) =>
    s.scheduledDays.map((dow) => `('${safeName(s.name)}', ${dow})`)
  );
  if (tuples.length === 0) {
    // No eligible sites — return a no-op subquery yielding 0 rows.
    return `(SELECT NULL::text, NULL::int WHERE FALSE)`;
  }
  return `(VALUES ${tuples.join(", ")})`;
}

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

  // Schedule grid: every (site, scheduled_dow) tuple from SITES config.
  const siteScheduleSql = buildSiteScheduleValuesSql(siteFilter);

  // Drift WHERE for per-robot drilldown (uses Drizzle columns).
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
    // Cross-join sites × all calendar days in the range (not just scheduled
    // days). We mark is_scheduled per (site, date) using a LEFT JOIN against
    // the schedule grid. Then in the outer SELECT:
    //  - Util / uptime: AVG only over scheduled days (CASE WHEN gate)
    //  - Servings: SUM across ALL days so off-schedule production still
    //    counts toward totals (matches Remy / VC DD numbers).
    const result: any = await db.execute(sql`
      WITH date_range AS (
        SELECT d::date AS date_col, EXTRACT(DOW FROM d)::int AS dow
        FROM generate_series(${from}::date, ${to}::date, '1 day'::interval) d
      ),
      schedule AS (
        SELECT site, dow
        FROM ${sql.raw(siteScheduleSql)} AS ss(site, dow)
      ),
      sites_in_play AS (
        SELECT DISTINCT site FROM schedule
      ),
      all_site_days AS (
        SELECT sip.site, dr.date_col, dr.dow
        FROM sites_in_play sip
        CROSS JOIN date_range dr
      ),
      per_day AS (
        SELECT
          asd.site,
          to_char(asd.date_col, 'YYYY-MM-DD') AS date,
          CASE WHEN sch.dow IS NOT NULL THEN true ELSE false END AS is_scheduled,
          AVG(dm.util_pct)::real                  AS daily_util,
          COALESCE(AVG(dm.uptime_pct), 100)::real AS daily_uptime,
          COALESCE(SUM(dm.servings), 0)::bigint   AS daily_servings,
          COUNT(DISTINCT dm.sn)                   AS daily_robots
        FROM all_site_days asd
        LEFT JOIN schedule sch
          ON sch.site = asd.site AND sch.dow = asd.dow
        LEFT JOIN daily_metrics dm
          ON dm.site = asd.site
         AND dm.date = to_char(asd.date_col, 'YYYY-MM-DD')
        GROUP BY asd.site, asd.date_col, sch.dow
      )
      SELECT
        ${bucketExpr}                            AS bucket,
        site,
        -- Util/uptime: averaged ONLY over scheduled days.
        -- Empty scheduled days count as 0 util / default uptime.
        AVG(CASE WHEN is_scheduled THEN COALESCE(daily_util, 0) END)::real AS util_pct_avg,
        AVG(CASE WHEN is_scheduled THEN daily_uptime ELSE NULL END)::real AS uptime_pct_avg,
        -- Servings: sum across ALL days regardless of schedule
        COALESCE(SUM(daily_servings), 0)::bigint AS servings_sum,
        MAX(daily_robots)                        AS robots_count
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
