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
  const wantTables = url.searchParams.get("tables") === "1";
  const tableForSchema = url.searchParams.get("schemaOf");
  const wantStates = url.searchParams.get("states") === "1";
  const stateHostname = url.searchParams.get("host");
  const stateDate = url.searchParams.get("stateDate");

  // ?states=1 → distinct system_run_mode values seen in last 30d + freq
  if (wantStates) {
    const project = process.env.GCP_PROJECT_ID;
    if (!project) return NextResponse.json({ error: "GCP_PROJECT_ID not set" }, { status: 500 });
    const sqlS = `
      SELECT system_run_mode, COUNT(*) AS n
      FROM \`chef-robotics-infra.coremetrics_staging.system_state_v0\`
      WHERE header_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
      GROUP BY system_run_mode
      ORDER BY n DESC
    `;
    try {
      const token = await getAccessToken();
      const r = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sqlS, useLegacySql: false, timeoutMs: 25000 }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        return NextResponse.json({ error: `BQ ${r.status}: ${body.slice(0, 400)}` }, { status: 502 });
      }
      const data = (await r.json()) as { rows?: { f: { v: string }[] }[] };
      return NextResponse.json({
        ok: true,
        states: (data.rows ?? []).map((row) => ({
          system_run_mode: row.f[0]?.v ?? "",
          n: Number(row.f[1]?.v ?? 0),
        })),
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "states query failed" }, { status: 500 });
    }
  }

  // ?host=<hostname>&stateDate=YYYY-MM-DD → compute "ACTIVE" hours from
  // system_state_v0 using LEAD to derive duration per state, filter to ACTIVE,
  // group by production_date (midnight local, hardcoded to America/Los_Angeles).
  if (stateHostname && stateDate && DATE_RE.test(stateDate)) {
    const project = process.env.GCP_PROJECT_ID;
    if (!project) return NextResponse.json({ error: "GCP_PROJECT_ID not set" }, { status: 500 });
    const safeHost = stateHostname.replace(/[^a-zA-Z0-9_-]/g, "");
    // Partition by (hostname, module_id) — a robot has multiple modules that
    // all publish state pings at the same header_time. Without module_id in
    // the PARTITION, LEAD returns the same header_time for concurrent modules,
    // making the derived duration 0.
    const sqlA = `
      WITH ordered AS (
        SELECT
          hostname,
          module_id,
          system_run_mode,
          header_time,
          LEAD(header_time) OVER (
            PARTITION BY hostname, module_id
            ORDER BY header_time
          ) AS next_time
        FROM \`chef-robotics-infra.coremetrics_staging.system_state_v0\`
        WHERE hostname = '${safeHost}'
          AND header_time BETWEEN TIMESTAMP('${stateDate} 00:00:00', 'America/Los_Angeles')
                              AND TIMESTAMP('${stateDate} 23:59:59', 'America/Los_Angeles')
      ),
      per_mod AS (
        SELECT
          module_id,
          system_run_mode,
          SUM(TIMESTAMP_DIFF(next_time, header_time, MILLISECOND)) / 3600000.0 AS hours,
          COUNT(*) AS pings,
          MAX(TIMESTAMP_DIFF(next_time, header_time, MILLISECOND)) AS max_gap_ms
        FROM ordered
        WHERE next_time IS NOT NULL
          AND TIMESTAMP_DIFF(next_time, header_time, MILLISECOND) < 3600000
        GROUP BY module_id, system_run_mode
      )
      SELECT
        system_run_mode,
        SUM(hours) AS hours,
        SUM(pings) AS pings,
        COUNT(DISTINCT module_id) AS n_modules,
        MAX(max_gap_ms) AS worst_gap_ms
      FROM per_mod
      GROUP BY system_run_mode
      ORDER BY hours DESC
    `;
    try {
      const token = await getAccessToken();
      const r = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sqlA, useLegacySql: false, timeoutMs: 25000 }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        return NextResponse.json({ error: `BQ ${r.status}: ${body.slice(0, 400)}` }, { status: 502 });
      }
      const data = (await r.json()) as { rows?: { f: { v: string }[] }[] };
      return NextResponse.json({
        ok: true,
        host: safeHost,
        date: stateDate,
        state_hours: (data.rows ?? []).map((row) => ({
          state: row.f[0]?.v ?? "",
          hours: +Number(row.f[1]?.v ?? 0).toFixed(2),
          pings: Number(row.f[2]?.v ?? 0),
          n_modules: Number(row.f[3]?.v ?? 0),
          worst_gap_ms: Number(row.f[4]?.v ?? 0),
        })),
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "state hours query failed" }, { status: 500 });
    }
  }

  // ?tables=1 → list all tables in coremetrics_staging dataset
  if (wantTables) {
    const project = process.env.GCP_PROJECT_ID;
    if (!project) return NextResponse.json({ error: "GCP_PROJECT_ID not set" }, { status: 500 });
    const sqlT = `
      SELECT table_name, table_type
      FROM \`chef-robotics-infra.coremetrics_staging.INFORMATION_SCHEMA.TABLES\`
      ORDER BY table_name
    `;
    try {
      const token = await getAccessToken();
      const r = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sqlT, useLegacySql: false, timeoutMs: 25000 }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        return NextResponse.json({ error: `BigQuery ${r.status}: ${body.slice(0, 400)}` }, { status: 502 });
      }
      const data = (await r.json()) as { rows?: { f: { v: string }[] }[] };
      const tables = (data.rows ?? []).map((row) => ({
        name: row.f[0]?.v ?? "",
        type: row.f[1]?.v ?? "",
      }));
      return NextResponse.json({ ok: true, tables });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "tables query failed" }, { status: 500 });
    }
  }

  // ?schemaOf=<table_name> → return columns for that table
  if (tableForSchema) {
    const project = process.env.GCP_PROJECT_ID;
    if (!project) return NextResponse.json({ error: "GCP_PROJECT_ID not set" }, { status: 500 });
    const safe = tableForSchema.replace(/[^a-zA-Z0-9_]/g, "");
    const sqlC = `
      SELECT column_name, data_type
      FROM \`chef-robotics-infra.coremetrics_staging.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = '${safe}'
      ORDER BY ordinal_position
    `;
    try {
      const token = await getAccessToken();
      const r = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sqlC, useLegacySql: false, timeoutMs: 25000 }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        return NextResponse.json({ error: `BigQuery ${r.status}: ${body.slice(0, 400)}` }, { status: 502 });
      }
      const data = (await r.json()) as { rows?: { f: { v: string }[] }[] };
      const cols = (data.rows ?? []).map((row) => ({
        name: row.f[0]?.v ?? "",
        type: row.f[1]?.v ?? "",
      }));
      return NextResponse.json({ ok: true, table: safe, columns: cols });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "schemaOf query failed" }, { status: 500 });
    }
  }

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
      meal_id,
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
      const mealId = obj.meal_id ?? "";
      const isWarmUp = mealId === "0e766b76-7b18-482a-9fb3-43d260c9d08c";
      return {
        hostname: obj.hostname ?? "",
        customer_id: obj.customer_id ?? "",
        label: obj.label ?? "",
        meal_id: mealId,
        is_warm_up: isWarmUp,
        start_time_utc: obj.start_time_iso ?? "",
        end_time_utc: obj.end_time_iso ?? "",
        duration_sec: durationSec,
        duration_hours: +(durationSec / 3600).toFixed(2),
        bowl_count: Number(obj.bowl_count ?? 0),
        production_date: prodDate,
        belongs_to_target_date: belongsToDate,
        counted_in_rollup:
          belongsToDate &&
          obj.label === "PRODUCTION" &&
          durationSec / 3600 <= 48 &&
          !isWarmUp,
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
