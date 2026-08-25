// GET /api/debug/sessions?site=CookUnity+LAX&date=2026-08-11
//
// Returns every BigQuery sessions_v0 row that the rollup would consider for
// the given (site, local production date). Includes the raw start_time,
// end_time, duration, hostname, and label — so you can eyeball exactly
// which sessions are contributing to that day's utilization.
//
// Editor-only. Doesn't apply any of the rollup's caps — you see raw BQ.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SITES } from "@/lib/sites-config";
import {
  getAccessToken,
  productionDateForUtc,
} from "@/lib/metrics-rollup";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // @ts-expect-error augmented in auth.ts
  if (!session.user.isEditor) {
    return NextResponse.json(
      { error: "forbidden — editors only" },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const siteName = url.searchParams.get("site") ?? "";
  const date = url.searchParams.get("date") ?? "";
  const wantSchema = url.searchParams.get("schema") === "1";
  const wantMeals = url.searchParams.get("meals") === "1";

  // ?meals=1 → return distinct meal_id values seen in PRODUCTION sessions
  // over the last 30 days. Use this to find the warm-up meal_id string.
  if (wantMeals) {
    const project = process.env.GCP_PROJECT_ID;
    if (!project) {
      return NextResponse.json({ error: "GCP_PROJECT_ID not set" }, { status: 500 });
    }
    const table =
      process.env.BQ_SESSIONS_TABLE ||
      "chef-robotics-infra.coremetrics_staging.sessions_v0";
    const sqlMeals = `
      SELECT meal_id, COUNT(*) AS n_sessions,
             SUM(DATETIME_DIFF(end_time, start_time, SECOND)) / 3600.0 AS total_hours
      FROM \`${table}\`
      WHERE start_time >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 30 DAY)
        AND label = 'PRODUCTION'
        AND end_time > start_time
      GROUP BY meal_id
      ORDER BY n_sessions DESC
      LIMIT 200
    `;
    try {
      const token = await getAccessToken();
      const r = await fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: sqlMeals, useLegacySql: false, timeoutMs: 25000 }),
        }
      );
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        return NextResponse.json({ error: `BigQuery ${r.status}: ${body.slice(0, 400)}` }, { status: 502 });
      }
      const data = (await r.json()) as { rows?: { f: { v: string }[] }[] };
      const meals = (data.rows ?? []).map((row) => ({
        meal_id: row.f[0]?.v ?? "",
        n_sessions: Number(row.f[1]?.v ?? 0),
        total_hours: +Number(row.f[2]?.v ?? 0).toFixed(1),
      }));
      return NextResponse.json({ ok: true, meals });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "meals query failed" }, { status: 500 });
    }
  }

  // Special mode: ?schema=1 → return sessions_v0 column list. Useful for
  // figuring out which column holds warm-up meal info without a BQ console.
  if (wantSchema) {
    const project = process.env.GCP_PROJECT_ID;
    if (!project) {
      return NextResponse.json(
        { error: "GCP_PROJECT_ID not set" },
        { status: 500 }
      );
    }
    const sqlSchema = `
      SELECT column_name, data_type
      FROM \`chef-robotics-infra.coremetrics_staging.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = 'sessions_v0'
      ORDER BY ordinal_position
    `;
    try {
      const token = await getAccessToken();
      const r = await fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: sqlSchema,
            useLegacySql: false,
            timeoutMs: 25000,
          }),
        }
      );
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        return NextResponse.json(
          { error: `BigQuery ${r.status}: ${body.slice(0, 400)}` },
          { status: 502 }
        );
      }
      const data = (await r.json()) as {
        rows?: { f: { v: string }[] }[];
      };
      const cols = (data.rows ?? []).map((row) => ({
        name: row.f[0]?.v ?? "",
        type: row.f[1]?.v ?? "",
      }));
      return NextResponse.json({ ok: true, columns: cols });
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message ?? "schema query failed" },
        { status: 500 }
      );
    }
  }

  if (!siteName || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "site (name) and date (YYYY-MM-DD) required" },
      { status: 400 }
    );
  }

  const site = SITES.find((s) => s.name === siteName);
  if (!site) {
    return NextResponse.json({ error: `unknown site: ${siteName}` }, { status: 400 });
  }

  const project = process.env.GCP_PROJECT_ID;
  if (!project) {
    return NextResponse.json({ error: "GCP_PROJECT_ID not set" }, { status: 500 });
  }
  const table =
    process.env.BQ_SESSIONS_TABLE ||
    "chef-robotics-infra.coremetrics_staging.sessions_v0";

  const customerIdsList = site.bqCustomerIds
    .map((c) => `'${c.replace(/'/g, "''")}'`)
    .join(", ");

  // Cast a wide net: pull sessions in a ±1 day UTC window around the target
  // date. We'll then filter to sessions that fall on the *local* production
  // day (2am boundary) in JS. This mirrors what the rollup does.
  const sql = `
    SELECT
      FORMAT_DATETIME('%Y-%m-%dT%H:%M:%S', start_time) AS start_time_iso,
      FORMAT_DATETIME('%Y-%m-%dT%H:%M:%S', end_time)   AS end_time_iso,
      hostname,
      customer_id,
      label,
      DATETIME_DIFF(end_time, start_time, SECOND) AS duration_sec,
      COALESCE(bowl_count, 0) AS bowl_count
    FROM \`${table}\`
    WHERE DATE(start_time)
            BETWEEN DATE_SUB(@date, INTERVAL 1 DAY)
                AND DATE_ADD(@date, INTERVAL 1 DAY)
      AND end_time IS NOT NULL
      AND end_time > start_time
      AND customer_id IN (${customerIdsList})
    ORDER BY hostname, start_time
  `;

  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: sql,
          useLegacySql: false,
          timeoutMs: 25000,
          queryParameters: [
            {
              name: "date",
              parameterType: { type: "DATE" },
              parameterValue: { value: date },
            },
          ],
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `BigQuery ${res.status}: ${body.slice(0, 400)}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      schema?: { fields: { name: string }[] };
      rows?: { f: { v: string }[] }[];
    };
    const fields = data.schema?.fields.map((f) => f.name) ?? [];
    const allRows = (data.rows ?? []).map((r) => {
      const obj: Record<string, string | undefined> = {};
      fields.forEach((name, i) => {
        obj[name] = r.f[i]?.v;
      });
      const durationSec = Number(obj.duration_sec ?? 0);
      const prodDate = obj.start_time_iso
        ? productionDateForUtc(obj.start_time_iso, site.timezone)
        : "";
      const belongsToDate = prodDate === date;
      return {
        hostname: obj.hostname ?? "",
        customer_id: obj.customer_id ?? "",
        label: obj.label ?? "",
        start_time_utc: obj.start_time_iso ?? "",
        end_time_utc: obj.end_time_iso ?? "",
        duration_sec: durationSec,
        duration_hours: +(durationSec / 3600).toFixed(2),
        bowl_count: Number(obj.bowl_count ?? 0),
        production_date: prodDate,
        belongs_to_target_date: belongsToDate,
        counted_in_rollup:
          belongsToDate && obj.label === "PRODUCTION" && durationSec / 3600 <= 48,
      };
    });

    // Summary by robot (hostname) for the target date
    const counted = allRows.filter((r) => r.counted_in_rollup);
    const byRobot = new Map<string, { sessions: number; hours: number; bowls: number }>();
    for (const r of counted) {
      const cur =
        byRobot.get(r.hostname) ?? { sessions: 0, hours: 0, bowls: 0 };
      cur.sessions += 1;
      cur.hours += r.duration_hours;
      cur.bowls += r.bowl_count;
      byRobot.set(r.hostname, cur);
    }
    const summary = Array.from(byRobot.entries())
      .map(([hostname, v]) => ({
        hostname,
        sessions: v.sessions,
        hours_raw: +v.hours.toFixed(2),
        session_cap_h: site.availableHrsPerDay * 1.5,
        daily_cap_h: Math.min(site.availableHrsPerDay * 1.5, 24),
        hours_after_cap: +Math.min(
          v.hours,
          Math.min(site.availableHrsPerDay * 1.5, 24)
        ).toFixed(2),
        util_pct: +(
          (Math.min(v.hours, Math.min(site.availableHrsPerDay * 1.5, 24)) /
            site.availableHrsPerDay) *
          100
        ).toFixed(1),
        bowls: v.bowls,
      }))
      .sort((a, b) => a.hostname.localeCompare(b.hostname));

    return NextResponse.json({
      ok: true,
      site: siteName,
      date,
      timezone: site.timezone,
      availableHrsPerDay: site.availableHrsPerDay,
      session_cap_h: site.availableHrsPerDay * 1.5,
      daily_cap_h: Math.min(site.availableHrsPerDay * 1.5, 24),
      total_rows_scanned: allRows.length,
      rows_belonging_to_target_date: allRows.filter(
        (r) => r.belongs_to_target_date
      ).length,
      rows_counted_in_rollup: counted.length,
      summary_by_robot: summary,
      raw_sessions: allRows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "query failed" },
      { status: 500 }
    );
  }
}
