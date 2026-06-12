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

  // SQL bucket expression — postgres can group by these directly
  // (date is stored as text YYYY-MM-DD).
  const bucketSql =
    grain === "day"
      ? sql<string>`${schema.dailyMetrics.date}`
      : grain === "week"
        ? sql<string>`to_char(to_date(${schema.dailyMetrics.date}, 'YYYY-MM-DD'), 'IYYY-"W"IW')`
        : sql<string>`to_char(to_date(${schema.dailyMetrics.date}, 'YYYY-MM-DD'), 'YYYY-MM')`;

  // Build WHERE
  const whereClauses = [
    gte(schema.dailyMetrics.date, from),
    lte(schema.dailyMetrics.date, to),
  ];
  if (siteFilter) {
    // If the user explicitly asked for an excluded site, return empty.
    if (EXCLUDED_SITES.includes(siteFilter)) {
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
    whereClauses.push(eq(schema.dailyMetrics.site, siteFilter));
  } else if (EXCLUDED_SITES.length > 0) {
    // Hide excluded sites from "All sites" rollup.
    whereClauses.push(notInArray(schema.dailyMetrics.site, EXCLUDED_SITES));
  }

  try {
    // Rollup query
    const rollup = await db
      .select({
        bucket: bucketSql.as("bucket"),
        site: schema.dailyMetrics.site,
        utilPctAvg: sql<number>`AVG(${schema.dailyMetrics.utilPct})`.as(
          "util_pct_avg"
        ),
        uptimePctAvg: sql<number>`AVG(${schema.dailyMetrics.uptimePct})`.as(
          "uptime_pct_avg"
        ),
        servingsSum: sql<number>`COALESCE(SUM(${schema.dailyMetrics.servings}), 0)`.as(
          "servings_sum"
        ),
        robotsCount: sql<number>`COUNT(DISTINCT ${schema.dailyMetrics.sn})`.as(
          "robots_count"
        ),
      })
      .from(schema.dailyMetrics)
      .where(and(...whereClauses))
      .groupBy(bucketSql, schema.dailyMetrics.site)
      .orderBy(bucketSql, schema.dailyMetrics.site);

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
        .where(and(...whereClauses))
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
