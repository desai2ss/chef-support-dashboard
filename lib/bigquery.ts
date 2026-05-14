// BigQuery client — fetches daily aggregate metrics.
//
// Env needed:
//   GCP_SA_KEY_BASE64 - base64-encoded service-account JSON
//   GCP_PROJECT_ID    - your GCP project
//   BQ_METRICS_TABLE  - fully-qualified table or view, e.g. project.dataset.daily_metrics
//
// Expected schema (matches what we agreed on):
//   customer        STRING
//   module_id       STRING
//   date            DATE
//   uptime_pct      FLOAT64
//   downtime_min    INT64
//   throughput      INT64   -- bowls/hr
//   missed_bowls    INT64
//   pstops          INT64
//
// We hit BigQuery's REST API (jobs.query) with a Google-issued access token derived
// from the service-account JWT — no @google-cloud/bigquery dep needed.

export type BQDailyRow = {
  customer: string;
  module_id: string;
  date: string; // YYYY-MM-DD
  uptime_pct: number;
  downtime_min: number;
  throughput: number;
  missed_bowls: number;
  pstops: number;
};

export function bigqueryConfigured() {
  return !!(process.env.GCP_SA_KEY_BASE64 && process.env.GCP_PROJECT_ID && process.env.BQ_METRICS_TABLE);
}

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

// --- Minimal JWT signer (RS256) using Node's crypto ---
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
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
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
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

export async function fetchDailyMetrics(daysBack = 1): Promise<BQDailyRow[]> {
  const project = process.env.GCP_PROJECT_ID!;
  const table = process.env.BQ_METRICS_TABLE!;
  const token = await getAccessToken();
  const sql = `
    SELECT customer, module_id,
           FORMAT_DATE('%Y-%m-%d', date) AS date,
           uptime_pct, downtime_min, throughput, missed_bowls, pstops
    FROM \`${table}\`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
    ORDER BY date DESC, customer, module_id
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
        query: sql,
        useLegacySql: false,
        queryParameters: [
          { name: "days", parameterType: { type: "INT64" }, parameterValue: { value: String(daysBack) } },
        ],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BigQuery ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    schema?: { fields: { name: string }[] };
    rows?: { f: { v: string }[] }[];
  };
  const fields = data.schema?.fields.map((f) => f.name) ?? [];
  const rows = (data.rows ?? []).map((r) => {
    const obj: any = {};
    fields.forEach((name, i) => { obj[name] = r.f[i]?.v; });
    return {
      customer: String(obj.customer ?? ""),
      module_id: String(obj.module_id ?? ""),
      date: String(obj.date ?? ""),
      uptime_pct: Number(obj.uptime_pct ?? 0),
      downtime_min: Number(obj.downtime_min ?? 0),
      throughput: Number(obj.throughput ?? 0),
      missed_bowls: Number(obj.missed_bowls ?? 0),
      pstops: Number(obj.pstops ?? 0),
    } satisfies BQDailyRow;
  });
  return rows;
}

export function summarize(rows: BQDailyRow[]) {
  if (rows.length === 0) {
    return { avgUptime: null, totalDowntime: 0, totalThroughput: 0, missedBowls: 0, pstops: 0 };
  }
  const avgUptime = rows.reduce((s, r) => s + r.uptime_pct, 0) / rows.length;
  const totalDowntime = rows.reduce((s, r) => s + r.downtime_min, 0);
  const totalThroughput = rows.reduce((s, r) => s + r.throughput, 0);
  const missedBowls = rows.reduce((s, r) => s + r.missed_bowls, 0);
  const pstops = rows.reduce((s, r) => s + r.pstops, 0);
  return { avgUptime, totalDowntime, totalThroughput, missedBowls, pstops };
}
