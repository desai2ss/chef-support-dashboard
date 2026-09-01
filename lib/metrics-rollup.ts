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
// Map site name -> IANA timezone (for local production-day bucketing).
const SITE_TZ = new Map(SITES.map((s) => [s.name, s.timezone]));
// Sites marked excludeFromMetrics: their robots are skipped in the rollup
// so daily_metrics never gets new rows for them.
const EXCLUDED_SITES = new Set(
  SITES.filter((s) => s.excludeFromMetrics).map((s) => s.name)
);

// Compute the customer-local production date for a UTC timestamp.
// Production day runs [local 2:00am, next-day local 1:59am]. So we shift
// the local wall clock back by 2 hours and take the calendar date.
//
//   utcIso: BigQuery DATETIME string like "2026-06-08T23:30:00" (no zone;
//           treated as UTC since BQ stores in UTC by convention here)
//   tz:     IANA timezone string ("America/Los_Angeles")
//
// Returns "YYYY-MM-DD".
export function productionDateForUtc(utcIso: string, tz: string): string {
  const ts = new Date(utcIso.endsWith("Z") ? utcIso : utcIso + "Z");
  if (Number.isNaN(ts.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(ts);
  const get = (t: string) =>
    parts.find((p) => p.type === t)?.value ?? "";
  const y = Number(get("year"));
  const m = Number(get("month")) - 1;
  const d = Number(get("day"));
  const h = Number(get("hour"));
  // Synthetic UTC date matching the local wall clock, shift back by 2h.
  const synth = new Date(Date.UTC(y, m, d, h));
  synth.setUTCHours(synth.getUTCHours() - 2);
  const yy = synth.getUTCFullYear();
  const mm = String(synth.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(synth.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Map hostname -> { sn, site, spare }. Spare robots are excluded from the
// rollup so they don't drag site utilization down while awaiting SAT or
// during long-term maintenance. They still appear on the Fleet tab.
const HOSTNAME_LOOKUP = new Map(
  ROBOTS.map((r) => [
    r.hostname,
    { sn: r.sn, site: r.site, spare: !!r.spare },
  ])
);
const SPARE_HOSTNAMES = new Set(
  ROBOTS.filter((r) => r.spare).map((r) => r.hostname)
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

export async function getAccessToken(): Promise<string> {
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
  start_time_iso: string; // BQ DATETIME (treated as UTC), e.g. "2026-06-08T23:30:00"
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
  // Pull raw start_time so JS can compute the local production date per
  // site. Date filter is expanded by ±1 day to catch sessions that straddle
  // midnight UTC but belong to a different local production day.
  const sqlStr = `
    SELECT
      FORMAT_DATETIME('%Y-%m-%dT%H:%M:%S', start_time) AS start_time_iso,
      hostname,
      customer_id,
      DATETIME_DIFF(end_time, start_time, SECOND) AS duration_sec,
      COALESCE(bowl_count, 0) AS bowl_count
    FROM \`${table}\`
    WHERE DATE(start_time)
            BETWEEN DATE_SUB(@from, INTERVAL 1 DAY)
                AND DATE_ADD(@to, INTERVAL 1 DAY)
      AND end_time IS NOT NULL
      AND end_time > start_time
      AND DATETIME_DIFF(end_time, start_time, HOUR) <= 48
      AND label = 'PRODUCTION'
      -- Exclude the "Warm Up Routine" meal — not real production, inflates util.
      -- meal_id sourced from BQ; add more IDs here if new warm-up variants show up.
      AND (meal_id IS NULL OR meal_id NOT IN (
        '0e766b76-7b18-482a-9fb3-43d260c9d08c'
      ))
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
      start_time_iso: String(obj.start_time_iso ?? ""),
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
// (Used only when falling back to session-based hours; state-based hours
// don't need this because they're direct measurements.)
const SESSION_CAP_MULTIPLIER = 1.5;

// ---- BQ query: state-based ACTIVE hours per (hostname, production_date) ----
//
// Reads system_state_v0 (per-module state pings) and derives per-module
// duration in each state via LEAD over consecutive pings. Sums to
// per-day ACTIVE hours (only counting the ACTIVE state). Uses midnight
// local (site tz) as the day boundary — this matches Remy/Retool.
//
// Returns Map<`${hostname}|${YYYY-MM-DD}`, activeHours>.
async function queryActiveHoursFromState(
  from: string,
  to: string
): Promise<Map<string, number>> {
  const project = process.env.GCP_PROJECT_ID;
  if (!project) throw new Error("GCP_PROJECT_ID not set");
  const token = await getAccessToken();

  // Build hostname → site tz mapping from ROBOTS + SITES config, then group
  // by tz so we can emit a compact CASE expression in SQL.
  const siteTz = new Map(SITES.map((s) => [s.name, s.timezone]));
  const hostTz = new Map<string, string>();
  for (const r of ROBOTS) {
    const tz = siteTz.get(r.site) ?? "UTC";
    hostTz.set(r.hostname, tz);
  }
  const hostnames = Array.from(hostTz.keys());
  if (hostnames.length === 0) return new Map();

  // Group hostnames by tz for compact CASE:
  //   CASE WHEN hostname IN ('a','b') THEN 'America/Los_Angeles'
  //        WHEN hostname IN ('c','d') THEN 'America/Edmonton'
  //   END
  const byTz = new Map<string, string[]>();
  for (const [h, tz] of hostTz) {
    if (!byTz.has(tz)) byTz.set(tz, []);
    byTz.get(tz)!.push(h);
  }
  const caseExpr =
    "CASE " +
    Array.from(byTz.entries())
      .map(
        ([tz, hs]) =>
          `WHEN hostname IN (${hs.map((h) => `'${h}'`).join(",")}) THEN '${tz}'`
      )
      .join(" ") +
    " ELSE 'UTC' END";
  const hostList = hostnames.map((h) => `'${h}'`).join(",");

  // Widen the raw scan by ±1 day (UTC) so that pings which fall inside a
  // local production day at the edges are still captured. The final
  // WHERE clips back to the requested [from, to] local window.
  const sqlStr = `
    WITH ordered AS (
      SELECT
        hostname,
        module_id,
        system_run_mode,
        header_time,
        DATE(header_time, ${caseExpr}) AS prod_date_local,
        LEAD(header_time) OVER (
          PARTITION BY hostname, module_id
          ORDER BY header_time
        ) AS next_time
      FROM \`chef-robotics-infra.coremetrics_staging.system_state_v0\`
      WHERE hostname IN (${hostList})
        AND header_time >= TIMESTAMP_SUB(TIMESTAMP('${from} 00:00:00', 'UTC'), INTERVAL 1 DAY)
        AND header_time <  TIMESTAMP_ADD(TIMESTAMP('${to} 23:59:59', 'UTC'), INTERVAL 1 DAY)
    ),
    per_ping AS (
      SELECT
        hostname,
        module_id,
        prod_date_local,
        system_run_mode,
        TIMESTAMP_DIFF(next_time, header_time, MILLISECOND) AS dur_ms
      FROM ordered
      WHERE next_time IS NOT NULL
        -- Drop gaps > 1h (robot rebooted / offline). Legit state durations
        -- almost never exceed a few minutes between pings.
        AND TIMESTAMP_DIFF(next_time, header_time, MILLISECOND) < 3600000
    ),
    per_mod_day AS (
      SELECT
        hostname,
        module_id,
        prod_date_local,
        SUM(CASE WHEN system_run_mode = 'ACTIVE' THEN dur_ms ELSE 0 END) / 3600000.0
          AS active_h
      FROM per_ping
      GROUP BY hostname, module_id, prod_date_local
    )
    SELECT
      hostname,
      FORMAT_DATE('%Y-%m-%d', prod_date_local) AS prod_date,
      SUM(active_h) AS active_hours
    FROM per_mod_day
    WHERE prod_date_local BETWEEN DATE('${from}') AND DATE('${to}')
    GROUP BY hostname, prod_date_local
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
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BigQuery (state) ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    schema?: { fields: { name: string }[] };
    rows?: { f: { v: string }[] }[];
  };
  const fields = data.schema?.fields.map((f) => f.name) ?? [];
  const out = new Map<string, number>();
  for (const r of data.rows ?? []) {
    const obj: Record<string, string | undefined> = {};
    fields.forEach((n, i) => (obj[n] = r.f[i]?.v));
    const host = obj.hostname ?? "";
    const date = obj.prod_date ?? "";
    const hrs = Number(obj.active_hours ?? 0);
    if (host && date) out.set(`${host}|${date}`, hrs);
  }
  return out;
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
  // Run both queries in parallel:
  //   sessions_v0  → servings (bowl_count per session)
  //   system_state_v0 → ACTIVE hours per (hostname, local prod date)
  const [sessions, activeHoursMap] = await Promise.all([
    querySessions(from, to),
    queryActiveHoursFromState(from, to),
  ]);
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
  let outOfRangeSessions = 0;
  for (const sess of sessions) {
    const robot = HOSTNAME_LOOKUP.get(sess.hostname);
    if (!robot) {
      unknown.add(sess.hostname);
      skipped++;
      continue;
    }
    // Spare robots (pre-SAT, decommissioned, etc.) are excluded from rollup.
    if (robot.spare) {
      skipped++;
      continue;
    }
    const site = siteFor(sess.customer_id, sess.hostname) ?? robot.site;
    // Skip sites flagged excludeFromMetrics — they don't get rolled up.
    if (EXCLUDED_SITES.has(site)) {
      excludedSiteSessions++;
      continue;
    }
    // Compute the customer-local production date (2am boundary).
    const tz = SITE_TZ.get(site) ?? "UTC";
    const prodDate = productionDateForUtc(sess.start_time_iso, tz);
    // Drop sessions that fall outside the requested window after the TZ shift
    // (we widened the BQ filter by ±1 day to capture boundary sessions).
    if (prodDate < from || prodDate > to) {
      outOfRangeSessions++;
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

    const key = `${robot.sn}|${prodDate}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.productionHours += sessionHours;
      existing.servings += sess.bowl_count;
    } else {
      aggregated.set(key, {
        sn: robot.sn,
        date: prodDate,
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
  // Ensure a row exists for every (hostname, date) that has state-based
  // ACTIVE hours, even if we didn't see any sessions for it. This is
  // important because state pings are the source of truth for util now.
  for (const [key, _hrs] of activeHoursMap) {
    const [hostname, date] = key.split("|");
    const robot = HOSTNAME_LOOKUP.get(hostname);
    if (!robot) continue;
    if (robot.spare) continue;
    if (EXCLUDED_SITES.has(robot.site)) continue;
    if (date < from || date > to) continue;
    const aggKey = `${robot.sn}|${date}`;
    if (!aggregated.has(aggKey)) {
      aggregated.set(aggKey, {
        sn: robot.sn,
        date,
        site: robot.site,
        productionHours: 0,
        servings: 0,
      });
    }
  }

  const rows: Row[] = Array.from(aggregated.values()).map((a) => {
    const availHrs = AVAILABLE_HRS.get(a.site);
    const robot = ROBOTS.find((r) => r.sn === a.sn);
    const activeHrs = robot
      ? activeHoursMap.get(`${robot.hostname}|${a.date}`) ?? 0
      : 0;
    // Prefer state-based ACTIVE hours (matches Remy). If we have no state
    // data for this cell (e.g. old date before state_v0 was populated),
    // fall back to the session-based capped hours as a last resort.
    const productionHours =
      activeHrs > 0
        ? +activeHrs.toFixed(2)
        : (() => {
            const dailyCap =
              availHrs && availHrs > 0
                ? Math.min(availHrs * SESSION_CAP_MULTIPLIER, 24)
                : 24;
            const capped = Math.min(a.productionHours, dailyCap);
            if (a.productionHours > dailyCap) dailyCapHits++;
            return capped;
          })();
    return {
      sn: a.sn,
      date: a.date,
      site: a.site,
      utilPct:
        availHrs && availHrs > 0 ? (productionHours / availHrs) * 100 : null,
      productionHours,
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

  // Also remove any pre-existing rows for spare SNs (e.g. nines-pc before
  // it passed SAT) so they stop dragging site averages down.
  const spareSns = ROBOTS.filter((r) => r.spare).map((r) => r.sn);
  if (spareSns.length > 0) {
    for (const sn of spareSns) {
      await db.execute(
        sql`DELETE FROM daily_metrics WHERE sn = ${sn} AND date BETWEEN ${from} AND ${to}`
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
