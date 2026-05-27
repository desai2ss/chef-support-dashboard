// Datadog client — fetches per-robot health.
//
// Env needed:
//   DATADOG_API_KEY  - "API key" from /organization-settings/api-keys
//   DATADOG_APP_KEY  - "Application key" from /personal-settings/application-keys
//   DATADOG_SITE     - e.g. datadoghq.com (US1), us3.datadoghq.com, datadoghq.eu, ...
//
// Chef Robotics tags series with the standard `host:<hostname>` tag where
// hostnames look like `asimo-pc`, `tinman-pc`, etc. (matches BigQuery
// sessions_v0.hostname). The Module Overview dashboard uses these same metrics.

// The tag key Datadog series are grouped by. For Chef Robotics this is the
// standard `host` tag (the `Module-Tag` filter on the existing dashboard is
// just a UI variable that maps to host:<value>).
const MODULE_TAG = "host";

// `datadog.agent.running` is emitted continuously while the agent is up.
// Absence = robot offline. Best signal for "is this robot online?".
const METRIC_AGENT_RUNNING = "datadog.agent.running";

// `wireless_rssi` is published by every Chef robot (visible on the existing
// Module Overview dashboard). Recent value = network signal strength in dBm.
const METRIC_WIRELESS_RSSI = "wireless_rssi";

export type ModuleHealth = {
  // The Datadog host tag value (e.g. "asimo-pc"). Matches BigQuery hostname.
  moduleId: string;
  customer?: string;
  // True if datadog.agent.running has a data point in the last 10 minutes.
  online: boolean;
  // Latest wireless signal strength in dBm (typically -30 strong … -90 weak).
  wirelessRssiDbm: number | null;
  // ISO timestamp of the most recent agent heartbeat.
  lastSeen: string | null;
  // Deprecated legacy fields — kept for back-compat with the old Dashboard
  // component until that page is fully migrated. Always null now.
  picksTotal: null;
  networkLatencyMs: null;
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
  // 1 hour window is plenty: agent.running emits every 10s, so any robot
  // that's actually online will have lots of data points here.
  const oneHourAgo = now - 60 * 60;

  const [heartbeat, rssi] = await Promise.all([
    queryScalar(
      `avg:${METRIC_AGENT_RUNNING}{*} by {${MODULE_TAG}}`,
      oneHourAgo,
      now
    ),
    queryScalar(
      `avg:${METRIC_WIRELESS_RSSI}{*} by {${MODULE_TAG}}`,
      oneHourAgo,
      now
    ),
  ]);

  const byId = new Map<string, ModuleHealth>();

  // Start with heartbeat — defines the universe of robots we know about.
  for (const s of heartbeat) {
    const id = tagFromScope(s.scope, MODULE_TAG);
    if (!id) continue;
    byId.set(id, {
      moduleId: id,
      // Online = last heartbeat within 10 minutes.
      online: s.lastTs !== null && now * 1000 - s.lastTs < 10 * 60 * 1000,
      wirelessRssiDbm: null,
      lastSeen: s.lastTs ? new Date(s.lastTs).toISOString() : null,
      picksTotal: null,
      networkLatencyMs: null,
    });
  }

  // Layer in wireless RSSI where available.
  for (const s of rssi) {
    const id = tagFromScope(s.scope, MODULE_TAG);
    if (!id) continue;
    const cur = byId.get(id);
    if (cur) {
      cur.wirelessRssiDbm = s.latest;
    } else {
      // Robot has RSSI but no heartbeat? Unusual but include it.
      byId.set(id, {
        moduleId: id,
        online: s.lastTs !== null && now * 1000 - s.lastTs < 10 * 60 * 1000,
        wirelessRssiDbm: s.latest,
        lastSeen: s.lastTs ? new Date(s.lastTs).toISOString() : null,
        picksTotal: null,
        networkLatencyMs: null,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.moduleId.localeCompare(b.moduleId)
  );
}

export function datadogConfigured() {
  return envOk();
}
