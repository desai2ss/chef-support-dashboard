// Pstop rollup: BigQuery → pstop_sessions_daily + pstop_counts_daily.
//
// Runs alongside the utilization rollup (runRollup in lib/metrics-rollup.ts),
// so the nightly cron and /api/metrics/backfill fill both. Mirrors the
// source-of-truth pstop query:
//   - completed (session_state_v0) PRODUCTION sessions with bowls (or null)
//   - pstops = WARNING_ROBOT_FAULTED_WHILE_RUN_MODE_ACTIVE alerts by session
//   - days are the site's local calendar day (midnight boundary)
// Only robots in the dashboard roster are counted (minus excludeFromMetrics
// robots and excluded sites), same as utilization.

import { db, schema } from "@/lib/db";
import { sql, and, gte, lte } from "drizzle-orm";
import { SITES } from "@/lib/sites-config";
import { ROBOTS, siteFor } from "@/lib/fleet-config";
import { getAccessToken } from "@/lib/metrics-rollup";

const PSTOP_CONDITION = "WARNING_ROBOT_FAULTED_WHILE_RUN_MODE_ACTIVE";

const EXCLUDED_SITES = new Set(
  SITES.filter((s) => s.excludeFromMetrics).map((s) => s.name)
);
const SITE_TZ = new Map(SITES.map((s) => [s.name, s.timezone]));

// Robots whose pstops we roll up: hostname -> { sn, site, tz }.
const PSTOP_ROBOTS = new Map(
  ROBOTS.filter((r) => !r.excludeFromMetrics && !EXCLUDED_SITES.has(r.site)).map(
    (r) => [r.hostname, { sn: r.sn, site: r.site, tz: SITE_TZ.get(r.site) ?? "UTC" }]
  )
);

// Create the tables if they don't exist yet. Memoized per server instance.
let ensured: Promise<void> | null = null;
export function ensurePstopTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pstop_sessions_daily (
          date text NOT NULL,
          sn integer NOT NULL,
          site text NOT NULL,
          ingredient text NOT NULL,
          sessions integer NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (date, sn, ingredient)
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pstop_counts_daily (
          session_date text NOT NULL,
          pstop_date text NOT NULL,
          sn integer NOT NULL,
          site text NOT NULL,
          ingredient text NOT NULL,
          pstops integer NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (session_date, pstop_date, sn, ingredient)
        )
      `);
    })().catch((e) => {
      ensured = null; // retry on next call
      throw e;
    });
  }
  return ensured;
}

type PstopBqRow = {
  kind: "sessions" | "pstops";
  sessionDate: string;
  customerId: string;
  hostname: string;
  ingredient: string;
  pstopDate: string | null;
  n: number;
};

// One BigQuery query for every robot in the roster. Returns session counts
// and pstop counts (by session date + pstop date) for sessions whose local
// start date is in [from, to].
export async function queryPstops(from: string, to: string): Promise<PstopBqRow[]> {
  const project = process.env.GCP_PROJECT_ID;
  if (!project) throw new Error("GCP_PROJECT_ID not set");
  if (PSTOP_ROBOTS.size === 0) return [];
  const token = await getAccessToken();

  const hostStructs = Array.from(PSTOP_ROBOTS.entries())
    .map(([h, r]) => `STRUCT('${h}' AS hostname, '${r.tz}' AS tz)`)
    .join(",\n        ");

  // Session scan is widened ±1 day (UTC) and the alert scan runs a few days
  // past `to` so sessions that run past midnight keep their late pstops;
  // the read API drops pstops dated after the selected To.
  const sqlStr = `
    WITH hosts AS (
      SELECT * FROM UNNEST([
        ${hostStructs}
      ])
    ),
    completed AS (
      SELECT DISTINCT session_id
      FROM \`chef-robotics-infra.coremetrics_staging.session_state_v0\`
      WHERE state = 'completed'
    ),
    prod_sessions AS (
      SELECT
        s.session_id,
        s.customer_id,
        s.hostname,
        h.tz,
        COALESCE(i.display_name, 'Unknown') AS ingredient,
        DATE(TIMESTAMP(s.start_time), h.tz) AS session_date
      FROM \`chef-robotics-infra.coremetrics_staging.sessions_v0\` s
      JOIN hosts h
        ON h.hostname = s.hostname
      JOIN completed c
        ON c.session_id = s.session_id
      LEFT JOIN \`chef-robotics-infra.coremetrics_staging.ingredients_v0\` i
        ON i.id = s.ingredient_id
      WHERE s.label = 'PRODUCTION'
        AND (s.bowl_count > 0 OR s.bowl_count IS NULL)
        AND DATE(s.start_time) BETWEEN DATE_SUB(@from, INTERVAL 1 DAY)
                                   AND DATE_ADD(@to, INTERVAL 1 DAY)
    ),
    in_range AS (
      SELECT * FROM prod_sessions
      WHERE session_date BETWEEN @from AND @to
    ),
    alerts AS (
      SELECT a.session_id, a.header_time
      FROM \`chef-robotics-infra.coremetrics_prod.alerts_v0_deduped\` a
      WHERE a.condition = '${PSTOP_CONDITION}'
        AND a.header_time >= TIMESTAMP(DATE_SUB(@from, INTERVAL 1 DAY))
        AND a.header_time <  TIMESTAMP(DATE_ADD(@to, INTERVAL 4 DAY))
    )
    SELECT
      'sessions' AS kind,
      FORMAT_DATE('%Y-%m-%d', session_date) AS session_date,
      customer_id,
      hostname,
      ingredient,
      CAST(NULL AS STRING) AS pstop_date,
      COUNT(*) AS n
    FROM in_range
    GROUP BY 2, 3, 4, 5
    UNION ALL
    SELECT
      'pstops' AS kind,
      FORMAT_DATE('%Y-%m-%d', r.session_date) AS session_date,
      r.customer_id,
      r.hostname,
      r.ingredient,
      FORMAT_DATE('%Y-%m-%d', DATE(a.header_time, r.tz)) AS pstop_date,
      COUNT(*) AS n
    FROM in_range r
    JOIN alerts a
      ON a.session_id = r.session_id
    GROUP BY 2, 3, 4, 5, 6
  `;

  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: sqlStr,
        useLegacySql: false,
        timeoutMs: 55000,
        maxResults: 100000,
        queryParameters: [
          { name: "from", parameterType: { type: "DATE" }, parameterValue: { value: from } },
          { name: "to", parameterType: { type: "DATE" }, parameterValue: { value: to } },
        ],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BigQuery (pstops) ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    jobComplete?: boolean;
    pageToken?: string;
    schema?: { fields: { name: string }[] };
    rows?: { f: { v: string | null }[] }[];
  };
  // We replace the window's rows wholesale, so never write a partial result.
  if (data.jobComplete === false) {
    throw new Error("BigQuery (pstops) query did not finish in time; try a smaller range");
  }
  if (data.pageToken) {
    throw new Error("BigQuery (pstops) result was paginated; try a smaller range");
  }
  const fields = data.schema?.fields.map((f) => f.name) ?? [];
  return (data.rows ?? []).map((r) => {
    const obj: Record<string, string | null | undefined> = {};
    fields.forEach((n, i) => (obj[n] = r.f[i]?.v));
    return {
      kind: obj.kind === "pstops" ? "pstops" : "sessions",
      sessionDate: String(obj.session_date ?? ""),
      customerId: String(obj.customer_id ?? ""),
      hostname: String(obj.hostname ?? ""),
      ingredient: String(obj.ingredient ?? "Unknown"),
      pstopDate: obj.pstop_date ? String(obj.pstop_date) : null,
      n: Number(obj.n ?? 0),
    };
  });
}

export type PstopRollupResult = {
  pstopSessionRows: number;
  pstopCountRows: number;
};

// Replace pstop rows for session dates in [from, to] with fresh BQ results.
export async function writePstops(
  from: string,
  to: string,
  bqRows: PstopBqRow[]
): Promise<PstopRollupResult> {
  await ensurePstopTables();

  const sessionRows: (typeof schema.pstopSessionsDaily.$inferInsert)[] = [];
  const countRows: (typeof schema.pstopCountsDaily.$inferInsert)[] = [];
  for (const r of bqRows) {
    const robot = PSTOP_ROBOTS.get(r.hostname);
    if (!robot) continue;
    // Guard against a hostname reused under another customer.
    if (siteFor(r.customerId, r.hostname) !== robot.site) continue;
    if (r.kind === "sessions") {
      sessionRows.push({
        date: r.sessionDate,
        sn: robot.sn,
        site: robot.site,
        ingredient: r.ingredient,
        sessions: r.n,
      });
    } else if (r.pstopDate) {
      countRows.push({
        sessionDate: r.sessionDate,
        pstopDate: r.pstopDate,
        sn: robot.sn,
        site: robot.site,
        ingredient: r.ingredient,
        pstops: r.n,
      });
    }
  }

  await db
    .delete(schema.pstopSessionsDaily)
    .where(
      and(
        gte(schema.pstopSessionsDaily.date, from),
        lte(schema.pstopSessionsDaily.date, to)
      )
    );
  await db
    .delete(schema.pstopCountsDaily)
    .where(
      and(
        gte(schema.pstopCountsDaily.sessionDate, from),
        lte(schema.pstopCountsDaily.sessionDate, to)
      )
    );

  const CHUNK = 500;
  for (let i = 0; i < sessionRows.length; i += CHUNK) {
    await db.insert(schema.pstopSessionsDaily).values(sessionRows.slice(i, i + CHUNK));
  }
  for (let i = 0; i < countRows.length; i += CHUNK) {
    await db.insert(schema.pstopCountsDaily).values(countRows.slice(i, i + CHUNK));
  }

  return { pstopSessionRows: sessionRows.length, pstopCountRows: countRows.length };
}
