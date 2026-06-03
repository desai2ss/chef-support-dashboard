"use client";

import { useEffect, useState } from "react";

type Robot = {
  hostname: string;
  sn: number;
  nickname: string;
  spare?: boolean;
  buildVersion: string | null;
  utilPct: number | null;
  productionHours: number;
  totalOperatingHours: number;
  prodDate: string | null;
  onboarded: boolean;
  online: boolean;
  rssiDbm: number | null;
};

type Site = {
  site: string;
  robotCount: number;
  onboardedCount: number;
  onlineCount: number;
  moduleUtilPct: number | null;
  siteTotalUtilPct: number | null;
  robots: Robot[];
};

type ApiResponse = {
  configured: boolean;
  hasBQ?: boolean;
  hasDD?: boolean;
  sites?: Site[];
  kpis?: {
    fleetAvgUtilPct: number | null;
    robotsWithData: number;
    totalRobots: number;
    ddOnline?: number;
    ddTotal?: number;
  };
  unknownHostnames?: { hostname: string; customer_id: string }[];
  error?: string;
  message?: string;
};

type RecentTicket = {
  id: string;
  number: number | null;
  title: string;
  site: string;
  state: string;
  link: string | null;
  createdAt: string | null;
};
type TicketsApi = {
  configured: boolean;
  total?: number;
  rows?: {
    id: string;
    number: number | null;
    title: string;
    site: string;
    module: string | null;
    state: string;
    link: string | null;
    createdAt: string | null;
    tags: string[];
  }[];
  error?: string;
};

function utilColor(pct: number | null): string {
  if (pct === null) return "bg-line";
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
      <div className="text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 rounded p-3 text-sm">
        {data.message ?? "BigQuery not configured."}
      </div>
    );
  }
  if (data.error) {
    return (
      <div className="text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 rounded p-3 text-sm">
        {data.error}
      </div>
    );
  }

  const sites = data.sites ?? [];
  const openTickets = tickets?.total ?? null;
  const fleetUtil = data.kpis?.fleetAvgUtilPct ?? null;

  // Tickets created in the last 24 hours, sorted newest first.
  const last24hAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentTickets: RecentTicket[] = (tickets?.rows ?? [])
    .filter((r) => {
      if (!r.createdAt) return false;
      const t = Date.parse(r.createdAt);
      return Number.isFinite(t) && t >= last24hAgo;
    })
    .map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      site: r.site,
      state: r.state,
      link: r.link,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  // "Below expected" = robots under 70% util as a placeholder; later this
  // will compare against per-customer expected_util_pct (manual entry).
  const robotsBelowExpected = sites.flatMap((s) =>
    s.robots.filter((r) => r.utilPct !== null && r.utilPct < 70)
  ).length;
  const breachedSla =
    tickets?.rows?.filter((r) => r.tags?.some((t) => /sla|breach/i.test(t))).length ??
    null;

  const ddOnline = data.kpis?.ddOnline ?? null;
  const ddTotal = data.kpis?.ddTotal ?? null;

  return (
    <div>
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Open Tickets" value={openTickets} hint="from Pylon" />
        <Kpi
          label="Robots Online"
          value={
            ddOnline !== null && ddTotal !== null
              ? `${ddOnline} / ${ddTotal}`
              : "—"
          }
          hint="from Datadog"
          tone={
            ddOnline !== null && ddTotal !== null && ddOnline === ddTotal
              ? "good"
              : ddOnline !== null && ddTotal !== null && ddOnline < ddTotal
              ? "warn"
              : undefined
          }
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
      </div>

      {/* New in last 24h */}
      <RecentTicketsPanel tickets={recentTickets} />

      {/* Site cards — hide sites with no robots in the roster */}
      {sites
        .filter((s) => s.robotCount > 0)
        .map((s) => (
          <SiteCard key={s.site} site={s} />
        ))}
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  new: "New",
  waiting_on_you: "Waiting on You",
  waiting_on_customer: "Waiting on Customer",
  on_hold: "On Hold",
};
const STATE_PILL: Record<string, string> = {
  new: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700/40",
  waiting_on_you: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700/40",
  waiting_on_customer: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700/40",
  on_hold: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function RecentTicketsPanel({ tickets }: { tickets: RecentTicket[] }) {
  return (
    <section className="mb-5 rounded-lg border border-line bg-card p-4">
      <div className="flex justify-between items-baseline mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          New in last 24h
        </h2>
        <span className="text-xs text-muted">
          {tickets.length} ticket{tickets.length === 1 ? "" : "s"} opened ·{" "}
          <a href="/tickets" className="hover:underline">
            see all →
          </a>
        </span>
      </div>
      {tickets.length === 0 ? (
        <div className="text-muted text-sm italic">
          No new Pylon tickets in the last 24 hours.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left py-1.5 w-16 font-medium">#</th>
                <th className="text-left py-1.5 font-medium">Title</th>
                <th className="text-left py-1.5 w-36 font-medium">Site</th>
                <th className="text-left py-1.5 w-40 font-medium">Status</th>
                <th className="text-right py-1.5 w-20 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody>
              {tickets.slice(0, 10).map((t) => (
                <tr key={t.id} className="border-t border-line/60">
                  <td className="py-1.5 align-top">
                    {t.link ? (
                      <a
                        href={t.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {t.number ?? "—"}
                      </a>
                    ) : (
                      <span className="text-muted">{t.number ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-1.5 align-top">{t.title}</td>
                  <td className="py-1.5 align-top text-muted">{t.site}</td>
                  <td className="py-1.5 align-top">
                    <span
                      className={
                        "inline-block px-2 py-0.5 rounded text-xs border " +
                        (STATE_PILL[t.state] ??
                          "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700")
                      }
                    >
                      {STATE_LABEL[t.state] ?? t.state}
                    </span>
                  </td>
                  <td className="py-1.5 align-top text-right text-xs text-muted">
                    {timeAgo(t.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tickets.length > 10 ? (
            <div className="text-xs text-muted mt-2 text-right">
              + {tickets.length - 10} more —{" "}
              <a href="/tickets" className="hover:underline">
                see all
              </a>
            </div>
          ) : null}
        </div>
      )}
    </section>
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
      : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-card p-4">
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
  const spareCount = site.robots.filter((r) => r.spare).length;
  const activeCount = site.robotCount - spareCount;
  return (
    <section className="mb-5 rounded-lg border border-line bg-card p-4">
      <div className="flex justify-between items-baseline mb-4">
        <div>
          <div className="text-lg font-semibold">{site.site}</div>
          <div className="text-xs text-muted">
            {activeCount} robots · {site.onlineCount} online
            {spareCount > 0 ? ` · ${spareCount} spare` : ""}
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
  // Online dot: Datadog heartbeat in last ~10min. Falls back to BQ session
  // activity (onboarded) if Datadog hasn't seen this robot at all.
  const onlineDot = r.online
    ? "bg-emerald-500"
    : r.onboarded
    ? "bg-amber-500"
    : "bg-line";
  return (
    <div className={"rounded border border-line bg-cream p-3 " + (r.spare ? "opacity-70" : "")}>
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm flex items-center gap-1.5">
          <span className="text-muted">SN{r.sn}</span>{" "}
          <span className="font-medium">{r.nickname}</span>
          {r.spare ? (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-line text-muted bg-card"
              title="Spare robot — not in active rotation"
            >
              Spare
            </span>
          ) : null}
        </div>
        <span className={"inline-block w-2 h-2 rounded-full " + onlineDot} />
      </div>
      <div className="mb-2">
        <div className="h-2 bg-line rounded overflow-hidden">
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
        <span title="Wireless RSSI">
          {r.rssiDbm != null ? `${Math.round(r.rssiDbm)} dBm` : "—"}
        </span>
      </div>
    </div>
  );
}
