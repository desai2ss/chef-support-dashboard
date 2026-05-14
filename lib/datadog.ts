// Datadog client — fetches per-module health.
//
// Env needed:
//   DATADOG_API_KEY  - "API key" from /organization-settings/api-keys
//   DATADOG_APP_KEY  - "Application key" from /personal-settings/application-keys
//   DATADOG_SITE     - e.g. datadoghq.com (US1), us3.datadoghq.com, datadoghq.eu, ...
//
// We expect per-module metrics tagged with `module:<id>` or `robot:<id>`. Adjust the
// `MODULE_TAG` and the metric names to match what your team publishes.

const MODULE_TAG = "module"; // tag key used on Datadog series
const METRIC_PICKS = "chef.module.picks.total"; // adjust to match what you publish
const METRIC_NETWORK_LATENCY = "chef.module.network.latency_ms"; // adjust to match

export type ModuleHealth = {
  moduleId: string;
  customer?: string;
  online: boolean;
  picksTotal: number | null;
  networkLatencyMs: number | null;
  lastSeen: string | null;
};

function envOk() {
  return !!(process.env.DATADOG_API_KEY && process.env.DATADOG_APP_KEY);
}

function site() {
  return process.env.DATADOG_SITE ?? "datadoghq.com";
}

async function dd<T>(path: string): Promise<T> {
  if (!envOk()) throw new Error("DATADOG_API_KEY / DATADOG_APP_KEY not set");
  const url = `https://api.${site()}${path}`;
  const res = await fetch(url, {
    headers: {
      "DD-API-KEY": process.env.DATADOG_API_KEY!,
      "DD-APPLICATION-KEY": process.env.DATADOG_APP_KEY!,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Datadog ${res.status} ${res.statusText} on ${path}`);
  }
  return (await res.json()) as T;
}

// Minimal query helper. We use the v1 query endpoint: GET /api/v1/query?from&to&query
async function queryScalar(query: string, fromSec: number, toSec: number): Promise<Array<{ scope: string; latest: number | null; lastTs: number | null }>> {
  type Series = {
    scope: string;
    pointlist: [number, number][]; // [ts_ms, value]
  };
  const path = `/api/v1/query?from=${fromSec}&to=${toSec}&query=${encodeURIComponent(query)}`;
  const data = await dd<{ series?: Series[] }>(path);
  return (data.series ?? []).map((s) => {
    const pts = s.pointlist?.filter((p) => p[1] !== null && !Number.isNaN(p[1])) ?? [];
    const last = pts[pts.length - 1];
    return {
      scope: s.scope ?? "",
      latest: last ? last[1] : null,
      lastTs: last ? last[0] : null,
    };
  });
}

function tagFromScope(scope: string, key: string): string | null {
  // scope looks like: "module:SN50,customer:Acme"
  for (const part of scope.split(",")) {
    const [k, ...rest] = part.split(":");
    if (k.trim() === key) return rest.join(":").trim();
  }
  return null;
}

export async function fetchModuleHealth(): Promise<ModuleHealth[]> {
  const now = Math.floor(Date.now() / 1000);
  const oneHourAgo = now - 60 * 60;
  const picks = await queryScalar(`sum:${METRIC_PICKS}{*} by {${MODULE_TAG},customer}`, oneHourAgo, now);
  const net = await queryScalar(`avg:${METRIC_NETWORK_LATENCY}{*} by {${MODULE_TAG},customer}`, oneHourAgo, now);

  const byId = new Map<string, ModuleHealth>();
  for (const s of picks) {
    const id = tagFromScope(s.scope, MODULE_TAG);
    if (!id) continue;
    byId.set(id, {
      moduleId: id,
      customer: tagFromScope(s.scope, "customer") ?? undefined,
      online: s.lastTs !== null && now * 1000 - s.lastTs < 10 * 60 * 1000,
      picksTotal: s.latest,
      networkLatencyMs: null,
      lastSeen: s.lastTs ? new Date(s.lastTs).toISOString() : null,
    });
  }
  for (const s of net) {
    const id = tagFromScope(s.scope, MODULE_TAG);
    if (!id) continue;
    const cur = byId.get(id) ?? {
      moduleId: id,
      customer: tagFromScope(s.scope, "customer") ?? undefined,
      online: s.lastTs !== null && now * 1000 - s.lastTs < 10 * 60 * 1000,
      picksTotal: null,
      networkLatencyMs: null,
      lastSeen: s.lastTs ? new Date(s.lastTs).toISOString() : null,
    };
    cur.networkLatencyMs = s.latest;
    byId.set(id, cur);
  }
  return Array.from(byId.values()).sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}

export function datadogConfigured() {
  return envOk();
}
