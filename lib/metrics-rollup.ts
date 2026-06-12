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
// Sites marked excludeFromMetrics: their robots are skipped in the rollup
// so daily_metrics never gets new rows for them.
const EXCLUDED_SITES = new Set(
  SITES.filter((s) => s.excludeFromMetrics).map((s) => s.name)
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

// ---- BQ query: one row per PRODUCTION session in the date range ----

type SessionRow = {
  prod_date: string;
  hostname: string;
  customer_id: string;
  duration_sec: number;
  bowl_count: number;
};

async function querySessions(
  from: string, // YYYY-MM-DD inclusive
  to: string // YYYY-MM-DD inclusive
): Promise<SessionRow[]> {
  const project = process.env.GCP_PROJECT_ID;
  if (!project) throw new Error("GCP_PROJECT_ID not set");
  const table =
    process.env.BQ_SESSIONS_TABLE ||
    "chef-robotics-infra.coremetrics_staging.sessions_v0";
  const token = await getAccessToken();

  const customerIdsList = ALL_CUSTOMER_IDS.map((c) => `'${c}'`).join(", ");

  // Return ONE row per PRODUCTION session so we can apply per-site duration
  // caps in JS (where the SITES config lives). We still filter clearly
  // garbage sessions in SQL (> 48h is definitely a stuck agent) to keep the
  // result set small. Per-site caps are enforced after the fetch.
  const sqlStr = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', DATE(start_time)) AS prod_date,
      hostname,
      customer_id,
      DATETIME_DIFF(end_time, start_time, SECOND) AS duration_sec,
      COALESCE(bowl_count, 0) AS bowl_count
    FROM \`${table}\`
    WHERE DATE(start_time) BETWEEN @from AND @to
      AND end_time IS NOT NULL
      AND end_time > start_time
      AND DATETIME_DIFF(end_time, start_time, HOUR) <= 48
      AND label = 'PRODUCTION'
      AND customer_id IN (${customerIdsList})
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
      duration_sec: Number(obj.duration_sec ?? 0),
      bowl_count: Number(obj.bowl_count ?? 0),
    };
  });
}

// Multiplier on availableHrsPerDay to compute the per-site max-session-length
// cap. A real production session shouldn't exceed 1.5× the scheduled day
// — anything longer is almost certainly a stuck agent with a bogus end_time.
const SESSION_CAP_MULTIPLIER = 1.5;

// ---- Main entrypoint -----------------------------------------------------

export type RollupResult = {
  from: string;
  to: string;
  rowsScanned: number;
  rowsWritten: number;
  rowsSkipped: number;
  // Hostnames we saw in BQ but couldn't map to a known SN.
  unknownHostnames: string[];
  // Sessions whose duration exceeded availableHrsPerDay × 1.5 and were capped.
  cappedSessions: number;
  // Sessions skipped because their site is flagged excludeFromMetrics.
  excludedSiteSessions: number;
  // (sn, date) rows whose daily total exceeded availHrs × 1.5 and were capped.
  dailyCapHits: number;
};

export async function runRollup(
  from: string,
  to: string
): Promise<RollupResult> {
  const sessions = await querySessions(from, to);
  let written = 0;
  let skipped = 0;
  const unknown = new Set<string>();
  let cappedSessions = 0;

  // Group sessions by (sn, date), applying per-site duration cap per session.
  type Agg = {
    sn: number;
    date: string;
    site: string;
    productionHours: number;
    servings: number; // total bowl_count summed across sessions
  };
  const aggregated = new Map<string, Agg>();

  let excludedSiteSessions = 0;
  for (const sess of sessions) {
    const robot = HOSTNAME_LOOKUP.get(sess.hostname);
    if (!robot) {
      unknown.add(sess.hostname);
      skipped++;
      continue;
    }
    const site = siteFor(sess.customer_id, sess.hostname) ?? robot.site;
    // Skip sites flagged excludeFromMetrics — they don't get rolled up.
    if (EXCLUDED_SITES.has(site)) {
      excludedSiteSessions++;
      continue;
    }
    const availHrs = AVAILABLE_HRS.get(site);
    // Cap this session at (availHrsPerDay × 1.5). Default to 24h when site
    // is unknown so a single bogus session can't blow up the total.
    const maxSessionHours =
      availHrs && availHrs > 0 ? availHrs * SESSION_CAP_MULTIPLIER : 24;
    const sessionHoursRaw = sess.duration_sec / 3600;
    const sessionHours = Math.min(sessionHoursRaw, maxSessionHours);
    if (sessionHoursRaw > maxSessionHours) cappedSessions++;

    const key = `${robot.sn}|${sess.prod_date}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.productionHours += sessionHours;
      existing.servings += sess.bowl_count;
    } else {
      aggregated.set(key, {
        sn: robot.sn,
        date: sess.prod_date,
        site,
        productionHours: sessionHours,
        servings: sess.bowl_count,
      });
    }
  }

  // Convert aggregated map to insert rows, applying a DAILY cap on
  // production_hours per (sn, date). Even with the per-session cap, multiple
  // overlapping/stuck sessions on the same day can sum to absurd totals
  // (e.g. CookUnity LAX showing 213% util on a 8-hr day = 17 hrs of "prod").
  // The daily cap = min(availHrs × 1.5, 24) keeps numbers physically possible:
  //   POH (4hr):  cap=6   → max util 150%
  //   LAX (8hr):  cap=12  → max util 150%
  //   CB (17hr):  cap=24  → max util 141% (physical 24h ceiling)
  //   Amys (16):  cap=24  → max util 150%
  let dailyCapHits = 0;
  type Row = {
    sn: number;
    date: string;
    site: string;
    utilPct: number | null;
    productionHours: number;
    servings: number | null;
  };
  const rows: Row[] = Array.from(aggregated.values()).map((a) => {
    const availHrs = AVAILABLE_HRS.get(a.site);
    const dailyCap =
      availHrs && availHrs > 0 ? Math.min(availHrs * SESSION_CAP_MULTIPLIER, 24) : 24;
    const cappedHours = Math.min(a.productionHours, dailyCap);
    if (a.productionHours > dailyCap) dailyCapHits++;
    return {
      sn: a.sn,
      date: a.date,
      site: a.site,
      utilPct:
        availHrs && availHrs > 0 ? (cappedHours / availHrs) * 100 : null,
      productionHours: cappedHours,
      servings: Math.round(a.servings),
    };
  });
  // Stash for the response (referenced after the loop)
  (rows as any)._dailyCapHits = dailyCapHits;

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
          servings: sql`excluded.servings`,
        },
      });
    written += batch.length;
  }

  // Best-effort cleanup: remove any pre-existing rows for excluded sites
  // (left over from before the exclusion flag was set).
  if (EXCLUDED_SITES.size > 0) {
    for (const site of EXCLUDED_SITES) {
      await db.execute(
        sql`DELETE FROM daily_metrics WHERE site = ${site} AND date BETWEEN ${from} AND ${to}`
      );
    }
  }

  return {
    from,
    to,
    rowsScanned: sessions.length,
    rowsWritten: written,
    rowsSkipped: skipped,
    excludedSiteSessions,
    unknownHostnames: Array.from(unknown).sort(),
    cappedSessions,
    dailyCapHits: (rows as any)._dailyCapHits ?? 0,
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
