"use client";

import { useEffect, useState } from "react";

type Robot = {
  hostname: string;
  sn: number;
  nickname: string;
  buildVersion: string | null;
  utilPct: number | null;
  productionHours: number;
  totalOperatingHours: number;
  prodDate: string | null;
  onboarded: boolean;
};

type Site = {
  site: string;
  robotCount: number;
  onboardedCount: number;
  moduleUtilPct: number | null;
  siteTotalUtilPct: number | null;
  robots: Robot[];
};

type ApiResponse = {
  configured: boolean;
  sites?: Site[];
  kpis?: {
    fleetAvgUtilPct: number | null;
    robotsWithData: number;
    totalRobots: number;
  };
  unknownHostnames?: { hostname: string; customer_id: string }[];
  error?: string;
  message?: string;
};

type TicketsApi = {
  configured: boolean;
  total?: number;
  rows?: { module: string | null; tags: string[] }[];
  error?: string;
};

function utilColor(pct: number | null): string {
  if (pct === null) return "bg-zinc-700";
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 60) return "bg-amber-500";
  return "bg-rose-500";
}

function fmtPct(p: number | null): string {
  if (p === null) return "—";
  return `${Math.round(p)}%`;
}

export default function FleetView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [tickets, setTickets] = useState<TicketsApi | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/fleet", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setData(j))
      .catch((e) =>
        alive && setData({ configured: true, error: String(e), sites: [] })
      );
    fetch("/api/tickets", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setTickets(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return <div className="text-muted text-sm">Loading fleet…</div>;
  if (!data.configured) {
    return (
      <div className="text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded p-3 text-sm">
        {data.message ?? "BigQuery not configured."}
      </div>
    );
  }
  if (data.error) {
    return (
      <div className="text-red-300 bg-red-950/40 border border-red-800/40 rounded p-3 text-sm">
        {data.error}
      </div>
    );
  }

  const sites = data.sites ?? [];
  const openTickets = tickets?.total ?? null;
  const untaggedTickets =
    tickets?.rows?.filter((r) => !r.module).length ?? null;
  const fleetUtil = data.kpis?.fleetAvgUtilPct ?? null;
  // "Below expected" = robots under 70% util as a placeholder; later this
  // will compare against per-customer expected_util_pct (manual entry).
  const robotsBelowExpected = sites.flatMap((s) =>
    s.robots.filter((r) => r.utilPct !== null && r.utilPct < 70)
  ).length;
  const breachedSla =
    tickets?.rows?.filter((r) => r.tags?.some((t) => /sla|breach/i.test(t))).length ??
    null;

  return (
    <div>
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Kpi label="Open Tickets" value={openTickets} hint="from Pylon" />
        <Kpi
          label="Breached SLA"
          value={breachedSla}
          hint="Needs attention"
          tone={breachedSla && breachedSla > 0 ? "danger" : undefined}
        />
        <Kpi
          label="Below Expected Util."
          value={robotsBelowExpected}
          hint="Robots < 70%"
          tone={robotsBelowExpected > 0 ? "warn" : undefined}
        />
        <Kpi
          label="Fleet Avg Util."
          value={fleetUtil !== null ? `${Math.round(fleetUtil)}%` : "—"}
          hint={`${data.kpis?.robotsWithData ?? 0} / ${data.kpis?.totalRobots ?? 0} robots reporting`}
          tone={fleetUtil !== null && fleetUtil >= 80 ? "good" : undefined}
        />
        <Kpi
          label="Untagged Tickets"
          value={untaggedTickets}
          hint="No module set"
          tone={untaggedTickets && untaggedTickets > 0 ? "info" : undefined}
        />
      </div>

      {/* Untagged tickets banner */}
      {untaggedTickets && untaggedTickets > 0 ? (
        <div className="mb-5 rounded border border-amber-900/40 bg-amber-950/30 px-4 py-3 flex justify-between items-center">
          <div className="text-sm">
            <span className="font-semibold text-amber-300">
              {untaggedTickets} ticket{untaggedTickets === 1 ? "" : "s"}
            </span>{" "}
            <span className="text-muted">
              have no Module field set — excluded from robot cards and may
              undercount open issues per robot.
            </span>
          </div>
          <a
            href="/tickets"
            className="text-amber-400 text-sm hover:underline whitespace-nowrap"
          >
            Review untagged →
          </a>
        </div>
      ) : null}

      {/* Site cards */}
      {sites.map((s) => (
        <SiteCard key={s.site} site={s} />
      ))}

      {/* Unknown hostnames advisory */}
      {data.unknownHostnames && data.unknownHostnames.length > 0 ? (
        <div className="mt-6 text-xs text-muted">
          <div className="font-semibold mb-1">
            BQ hostnames not in fleet roster:
          </div>
          <ul className="list-disc list-inside">
            {data.unknownHostnames.map((u) => (
              <li key={u.hostname}>
                <code>{u.hostname}</code> (customer: <code>{u.customer_id}</code>)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string | null;
  hint?: string;
  tone?: "good" | "warn" | "danger" | "info";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
      ? "text-amber-400"
      : tone === "danger"
      ? "text-rose-400"
      : tone === "info"
      ? "text-blue-400"
      : "text-white";
  return (
    <div className="rounded-lg border border-line bg-zinc-950/60 p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className={"text-3xl font-semibold mt-1 " + toneCls}>
        {value === null ? "—" : value}
      </div>
      {hint ? <div className="text-xs text-muted mt-1">{hint}</div> : null}
    </div>
  );
}

function SiteCard({ site }: { site: Site }) {
  return (
    <section className="mb-5 rounded-lg border border-line bg-zinc-950/40 p-4">
      <div className="flex justify-between items-baseline mb-4">
        <div>
          <div className="text-lg font-semibold">{site.site}</div>
          <div className="text-xs text-muted">
            {site.robotCount} robots · {site.onboardedCount} reporting
          </div>
        </div>
        <div className="flex gap-6 text-xs">
          <Stat label="Module util" value={fmtPct(site.moduleUtilPct)} />
          <Stat label="Site total util" value={fmtPct(site.siteTotalUtilPct)} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {site.robots.map((r) => (
          <RobotCard key={r.hostname} r={r} />
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted uppercase tracking-wider mr-2">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function RobotCard({ r }: { r: Robot }) {
  const pct = r.utilPct;
  const onlineDot = r.onboarded ? "bg-emerald-500" : "bg-zinc-600";
  return (
    <div className="rounded border border-line bg-zinc-900/60 p-3">
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm">
          <span className="text-muted">SN{r.sn}</span>{" "}
          <span className="font-medium">{r.nickname}</span>
        </div>
        <span className={"inline-block w-2 h-2 rounded-full " + onlineDot} />
      </div>
      <div className="mb-2">
        <div className="h-2 bg-zinc-800 rounded overflow-hidden">
          <div
            className={"h-full " + utilColor(pct)}
            style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
          />
        </div>
        <div className="flex justify-end text-xs mt-1">
          <span
            className={
              pct === null
                ? "text-muted"
                : pct >= 80
                ? "text-emerald-400"
                : pct >= 60
                ? "text-amber-400"
                : "text-rose-400"
            }
          >
            {fmtPct(pct)}
          </span>
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>{r.buildVersion ?? "—"}</span>
        <span>—</span>
      </div>
    </div>
  );
}
