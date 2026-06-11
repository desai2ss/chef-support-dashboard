// Rolls up BigQuery sessions_v0 data into the daily_metrics Postgres table.
//
// Backfill: run once for a 90-day range via /api/metrics/backfill?from=X&to=Y.
// Incremental: cron hits /api/metrics/backfill?from=yesterday&to=yesterday nightly.
//
// Auto-fills `util_pct`, `production_hours` for each (sn, date). Does NOT
// touch `uptime_pct` / `uptime_pylon_ticket` — those stay at whatever the
// editor set them to (or 100 default). `servings` stays null until we
// confirm where that data lives.

import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { SITES } from "@/lib/sites-config";
import { ROBOTS, siteFor } from "@/lib/fleet-config";

// Map site name -> available hrs/day (for util % denominator).
const AVAILABLE_HRS = new Map(
  SITES.map((s) => [s.name, s.availableHrsPerDay])
);

// Map hostname -> { sn, site }
const HOSTNAME_LOOKUP = new Map(
  ROBOTS.map((r) => [r.hostname, { sn: r.sn, site: r.site }])
);

// All BQ customer_ids we want to query.
const ALL_CUSTOMER_IDS = Array.from(
  new Set(SITES.flatMap((s) => s.bqCustomerIds))
);

// ---- BigQuery JWT/token helpers (mirrors lib/bigquery.ts) ----------------

type SAKey = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

function loadSAKey(): SAKey {
  const raw = process.env.GCP_SA_KEY_BASE64;
  if (!raw) throw new Error("GCP_SA_KEY_BASE64 not set");
  const json = Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json) as SAKey;
}

async function signJwt(sa: SAKey): Promise<string> {
  const { createSign } = await import("node:crypto");
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/bigquery.readonly",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const sig = signer.sign(sa.private_key).toString("base64url");
  return `${unsigned}.${sig}`;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const sa = loadSAKey();
  const jwt = await signJwt(sa);
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

// ---- BQ query: production_hours per (hostname, date) for a date range ----

type SessionAggRow = {
  prod_date: string;
  hostname: string;
  customer_id: string;
  production_hours: number;
};

async function querySessions(
  from: string, // YYYY-MM-DD inclusive
  to: string // YYYY-MM-DD inclusive
): Promise<SessionAggRow[]> {
  const project = process.env.GCP_PROJECT_ID;
  if (!project) throw new Error("GCP_PROJECT_ID not set");
  const table =
    process.env.BQ_SESSIONS_TABLE ||
    "chef-robotics-infra.coremetrics_staging.sessions_v0";
  const token = await getAccessToken();

  const customerIdsList = ALL_CUSTOMER_IDS.map((c) => `'${c}'`).join(", ");

  // Filter out clearly-stuck sessions (> 16h between start_time and end_time).
  // These are almost always orphaned sessions where the agent crashed and
  // end_time was set hours/days later — they wildly inflate production_hours.
  // No legitimate single PRODUCTION session lasts more than ~16h.
  const sqlStr = `
    WITH session_durations AS (
      SELECT
        DATE(start_time) AS prod_date,
        hostname,
        customer_id,
        label,
        TIMESTAMP_DIFF(end_time, start_time, SECOND) AS duration_sec
      FROM \`${table}\`
      WHERE DATE(start_time) BETWEEN @from AND @to
        AND end_time IS NOT NULL
        AND end_time > start_time
        AND TIMESTAMP_DIFF(end_time, start_time, HOUR) <= 16
        AND customer_id IN (${customerIdsList})
    )
    SELECT
      FORMAT_DATE('%Y-%m-%d', prod_date) AS prod_date,
      hostname,
      customer_id,
      SUM(IF(label = 'PRODUCTION', duration_sec, 0)) / 3600.0 AS production_hours
    FROM session_durations
    GROUP BY prod_date, hostname, customer_id
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
        timeoutMs: 60000,
        queryParameters: [
          { name: "from", parameterType: { type: "DATE" }, parameterValue: { value: from } },
          { name: "to", parameterType: { type: "DATE" }, parameterValue: { value: to } },
        ],
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BigQuery ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    schema?: { fields: { name: string }[] };
    rows?: { f: { v: string }[] }[];
  };
  const fields = data.schema?.fields.map((f) => f.name) ?? [];
  return (data.rows ?? []).map((r) => {
    const obj: Record<string, string | undefined> = {};
    fields.forEach((name, i) => {
      obj[name] = r.f[i]?.v;
    });
    return {
      prod_date: String(obj.prod_date ?? ""),
      hostname: String(obj.hostname ?? ""),
      customer_id: String(obj.customer_id ?? ""),
      production_hours: Number(obj.production_hours ?? 0),
    };
  });
}

// ---- Main entrypoint -----------------------------------------------------

export type RollupResult = {
  from: string;
  to: string;
  rowsScanned: number;
  rowsWritten: number;
  rowsSkipped: number;
  // Hostnames we saw in BQ but couldn't map to a known SN.
  unknownHostnames: string[];
};

export async function runRollup(
  from: string,
  to: string
): Promise<RollupResult> {
  const sessions = await querySessions(from, to);
  let written = 0;
  let skipped = 0;
  const unknown = new Set<string>();

  // Map each BQ row to a daily_metrics row. Skip unknown hostnames.
  type Row = {
    sn: number;
    date: string;
    site: string;
    utilPct: number | null;
    productionHours: number;
    servings: number | null;
  };
  const rows: Row[] = [];
  for (const row of sessions) {
    const robot = HOSTNAME_LOOKUP.get(row.hostname);
    if (!robot) {
      unknown.add(row.hostname);
      skipped++;
      continue;
    }
    const site = siteFor(row.customer_id, row.hostname) ?? robot.site;
    const hrsAvail = AVAILABLE_HRS.get(site);
    const utilPct =
      hrsAvail && hrsAvail > 0
        ? (row.production_hours / hrsAvail) * 100
        : null;
    rows.push({
      sn: robot.sn,
      date: row.prod_date,
      site,
      utilPct,
      productionHours: row.production_hours,
      servings: null,
    });
  }

  // Batch upsert in chunks. `excluded.column` references the row that
  // would have been inserted, so the SET clause picks up per-row values.
  // We intentionally do NOT touch uptime_pct / uptime_pylon_ticket / uptime_note —
  // those are owned by the editor.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await db
      .insert(schema.dailyMetrics)
      .values(batch)
      .onConflictDoUpdate({
        target: [schema.dailyMetrics.sn, schema.dailyMetrics.date],
        set: {
          site: sql`excluded.site`,
          utilPct: sql`excluded.util_pct`,
          productionHours: sql`excluded.production_hours`,
        },
      });
    written += batch.length;
  }

  return {
    from,
    to,
    rowsScanned: sessions.length,
    rowsWritten: written,
    rowsSkipped: skipped,
    unknownHostnames: Array.from(unknown).sort(),
  };
}

// Helper: list of YYYY-MM-DD strings from `from` to `to` inclusive.
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// `sql` re-exported so route handlers don't need their own drizzle import.
export { sql };
