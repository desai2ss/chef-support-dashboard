"use client";

// Metrics tab — Util %, Uptime %, Total Servings over a selected date range.
// Phase 1: read-only. Backed by /api/metrics (rollup) and seeded by the
// admin endpoint /api/metrics/backfill.

import { useEffect, useMemo, useState } from "react";
import { SITES } from "@/lib/sites-config";

type RollupRow = {
  bucket: string; // YYYY-MM-DD | YYYY-Wxx | YYYY-MM
  site: string;
  utilPctAvg: number | null;
  uptimePctAvg: number | null;
  servingsSum: number | null;
  robotsCount: number;
};

type ApiResponse = {
  ok?: boolean;
  grain: "day" | "week" | "month";
  from: string;
  to: string;
  site: string | null;
  rows: RollupRow[];
  daily?: any[];
  error?: string;
};

// ---- date helpers --------------------------------------------------------
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// ---- presets -------------------------------------------------------------
type Preset = { label: string; days: number };
const PRESETS: Preset[] = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

type Grain = "day" | "week" | "month";

export default function MetricsView({ editor }: { editor: boolean }) {
  // Default to last 30 days
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [from, setFrom] = useState<string>(fmtDate(addDays(today, -30)));
  const [to, setTo] = useState<string>(fmtDate(today));
  const [grain, setGrain] = useState<Grain>("day");
  const [siteFilter, setSiteFilter] = useState<string>("");

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from, to, grain });
    if (siteFilter) qs.set("site", siteFilter);
    fetch(`/api/metrics?${qs.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (!j.ok) {
          setError(j.error ?? "Request failed");
          setData(null);
        } else {
          setData(j);
        }
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [from, to, grain, siteFilter]);

  // Compute KPI totals + unique buckets/sites for the chart and table.
  const { fleetUtil, fleetUptime, totalServings, buckets, sitesShown } =
    useMemo(() => {
      const rows = data?.rows ?? [];
      const buckets = Array.from(new Set(rows.map((r) => r.bucket))).sort();
      const sitesShown = Array.from(new Set(rows.map((r) => r.site))).sort();
      let utilSum = 0,
        utilN = 0;
      let uptimeSum = 0,
        uptimeN = 0;
      let servings = 0;
      for (const r of rows) {
        if (r.utilPctAvg !== null && r.utilPctAvg !== undefined) {
          utilSum += r.utilPctAvg;
          utilN += 1;
        }
        if (r.uptimePctAvg !== null && r.uptimePctAvg !== undefined) {
          uptimeSum += r.uptimePctAvg;
          uptimeN += 1;
        }
        servings += r.servingsSum ?? 0;
      }
      return {
        fleetUtil: utilN > 0 ? utilSum / utilN : null,
        fleetUptime: uptimeN > 0 ? uptimeSum / uptimeN : null,
        totalServings: servings,
        buckets,
        sitesShown,
      };
    }, [data]);

  // Pivot rows into site -> bucket -> RollupRow for table + chart.
  const matrix = useMemo(() => {
    const m = new Map<string, Map<string, RollupRow>>();
    for (const r of data?.rows ?? []) {
      if (!m.has(r.site)) m.set(r.site, new Map());
      m.get(r.site)!.set(r.bucket, r);
    }
    return m;
  }, [data]);

  function applyPreset(p: Preset) {
    setFrom(fmtDate(addDays(today, -p.days)));
    setTo(fmtDate(today));
  }

  return (
    <div>
      {/* Controls */}
      <section className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
              From
            </label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-card border border-line rounded-md px-2 py-1 text-sm focus:outline-none focus:border-zinc-400"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
              To
            </label>
            <input
              type="date"
              value={to}
              min={from}
              max={fmtDate(today)}
              onChange={(e) => setTo(e.target.value)}
              className="bg-card border border-line rounded-md px-2 py-1 text-sm focus:outline-none focus:border-zinc-400"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
              Grain
            </label>
            <div className="flex border border-line rounded-md overflow-hidden text-sm">
              {(["day", "week", "month"] as Grain[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGrain(g)}
                  className={
                    "px-3 py-1 " +
                    (grain === g
                      ? "bg-ink text-cream"
                      : "bg-card hover:bg-cream text-ink")
                  }
                >
                  {g[0].toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
              Site
            </label>
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="bg-card border border-line rounded-md px-2 py-1 text-sm focus:outline-none focus:border-zinc-400"
            >
              <option value="">All sites</option>
              {SITES.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1 ml-auto">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="text-xs px-2 py-1 rounded-md border border-line bg-card hover:bg-cream"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Status / errors */}
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="mb-4 text-muted text-sm">Loading metrics…</div>
      ) : null}
      {!loading && !error && (data?.rows.length ?? 0) === 0 ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No data yet for this range. If this is a fresh deploy, run the
          backfill: <code>POST /api/metrics/backfill?from={from}&amp;to={to}</code>{" "}
          (editor only) — it queries BigQuery for that window and populates
          the daily_metrics table.
        </div>
      ) : null}

      {/* KPI cards */}
      <section className="grid grid-cols-3 gap-4 mb-5">
        <KpiCard
          label="Fleet utilization"
          value={fleetUtil !== null ? fleetUtil.toFixed(1) + "%" : "—"}
          sub="avg across all reported (site × period) cells"
        />
        <KpiCard
          label="Fleet uptime"
          value={fleetUptime !== null ? fleetUptime.toFixed(1) + "%" : "—"}
          sub="default 100 minus manually-logged downtime"
        />
        <KpiCard
          label="Total servings"
          value={totalServings > 0 ? totalServings.toLocaleString() : "—"}
          sub="(source TBD — placeholder)"
        />
      </section>

      {/* Chart — utilization per site over time */}
      <section className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="text-base font-semibold">Utilization % over time</h2>
          <span className="text-xs text-muted">
            grain: {grain} · {sitesShown.length} sites · {buckets.length}{" "}
            buckets
          </span>
        </div>
        <LineChart
          buckets={buckets}
          matrix={matrix}
          sites={sitesShown}
          metric="utilPctAvg"
          yMax={150}
        />
      </section>

      {/* Pivot table — site × bucket */}
      <section className="rounded-xl border border-line bg-card p-5">
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="text-base font-semibold">
            {siteFilter
              ? `${siteFilter} — ${grain}ly`
              : `All sites — ${grain}ly utilization %`}
          </h2>
          <span className="text-xs text-muted">
            {from} – {to}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left py-2 px-2 sticky left-0 bg-card font-medium">
                  Site
                </th>
                {buckets.map((b) => (
                  <th key={b} className="text-right py-2 px-2 font-medium">
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sitesShown.map((site) => (
                <tr key={site} className="border-t border-line">
                  <td className="py-2 px-2 sticky left-0 bg-card text-ink font-medium">
                    {site}
                  </td>
                  {buckets.map((b) => {
                    const cell = matrix.get(site)?.get(b);
                    if (!cell || cell.utilPctAvg === null) {
                      return (
                        <td
                          key={b}
                          className="py-2 px-2 text-right text-muted/40"
                        >
                          —
                        </td>
                      );
                    }
                    return (
                      <td
                        key={b}
                        className="py-2 px-2 text-right text-ink tabular-nums"
                        title={`${cell.robotsCount} robots reported`}
                      >
                        {cell.utilPctAvg.toFixed(0)}%
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!editor ? (
          <div className="mt-3 text-xs text-muted">
            Read-only view. Phase 2 will add click-to-edit downtime cells with
            required Pylon ticket reference.
          </div>
        ) : (
          <div className="mt-3 text-xs text-muted">
            Phase 2 (coming): click cells to log downtime with a Pylon ticket.
          </div>
        )}
      </section>

      {/* Methodology — explains exactly how every number is calculated */}
      <MethodologySection />
    </div>
  );
}

function MethodologySection() {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-5 rounded-xl border border-line bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex justify-between items-center px-5 py-4 text-left hover:bg-cream/60"
      >
        <div>
          <h2 className="text-base font-semibold">
            How these metrics are calculated
          </h2>
          <div className="text-xs text-muted mt-0.5">
            Data sources, formulas, and gotchas for every number on this page
          </div>
        </div>
        <span className="text-muted text-lg" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? (
        <div className="px-5 pb-5 text-sm text-ink space-y-4 border-t border-line">
          {/* Utilization */}
          <div>
            <h3 className="font-semibold mt-3 mb-1">Utilization %</h3>
            <p className="text-muted">
              For each (robot, date), util % ={" "}
              <code className="text-[12px] bg-cream px-1 py-0.5 rounded">
                production_hours / availableHrsPerDay × 100
              </code>
              .
            </p>
            <ul className="text-muted text-[13px] mt-1 ml-5 list-disc space-y-1">
              <li>
                <code className="text-[12px]">production_hours</code> comes
                from BigQuery{" "}
                <code className="text-[12px]">
                  chef-robotics-infra.coremetrics_staging.sessions_v0
                </code>{" "}
                — we sum the duration of every session where{" "}
                <code className="text-[12px]">label = &apos;PRODUCTION&apos;</code>{" "}
                for that robot on that date.
              </li>
              <li>
                Stuck sessions (where{" "}
                <code className="text-[12px]">end_time − start_time &gt; 16h</code>
                ) are filtered out — they&apos;re almost always orphaned
                sessions from a crashed agent and inflate the number.
              </li>
              <li>
                <code className="text-[12px]">availableHrsPerDay</code> is a
                per-site constant in{" "}
                <code className="text-[12px]">lib/sites-config.ts</code>{" "}
                representing the scheduled shift length. Edit it there if a
                site changes its hours.
              </li>
              <li>
                Util % can exceed 100% when a robot runs overtime relative to
                its scheduled hours — same convention as the VC DD Stats
                spreadsheet (e.g. Amy&apos;s MED often hits 130-150%).
              </li>
              <li>
                The bucket (day / week / month) rolls up util as a simple
                average across the matching days for each site.
              </li>
            </ul>
          </div>

          {/* Uptime */}
          <div>
            <h3 className="font-semibold mt-3 mb-1">Uptime %</h3>
            <p className="text-muted">
              Defaults to <strong>100%</strong> for every (robot, date) cell.
              Editors lower it manually via the downtime modal (Phase 2),
              which requires linking a Pylon ticket explaining the downtime —
              so every reduction below 100 has an auditable cause.
            </p>
            <ul className="text-muted text-[13px] mt-1 ml-5 list-disc space-y-1">
              <li>
                Stored in column{" "}
                <code className="text-[12px]">uptime_pct</code> of the{" "}
                <code className="text-[12px]">daily_metrics</code> table in
                Neon Postgres.
              </li>
              <li>
                The BigQuery rollup never touches uptime — only the editor
                does. Re-running the backfill won&apos;t erase manual entries.
              </li>
              <li>
                Bucket rollups average uptime across days. So if a robot was
                100% all week except one day at 50%, weekly avg = 92.9%.
              </li>
            </ul>
          </div>

          {/* Servings */}
          <div>
            <h3 className="font-semibold mt-3 mb-1">Total servings</h3>
            <p className="text-muted">
              <strong>Currently a placeholder.</strong> The VC DD spreadsheet
              tracks servings counts but we haven&apos;t identified which BQ
              column or table they come from yet — possibly{" "}
              <code className="text-[12px]">deposits</code> on{" "}
              <code className="text-[12px]">sessions_v0</code>, or a separate
              table. Until that&apos;s wired, the column reads{" "}
              <code className="text-[12px]">null</code> and the KPI shows{" "}
              <em>—</em>.
            </p>
          </div>

          {/* Data flow */}
          <div>
            <h3 className="font-semibold mt-3 mb-1">Data flow &amp; freshness</h3>
            <ol className="text-muted text-[13px] ml-5 list-decimal space-y-1">
              <li>
                <strong>BigQuery sessions_v0</strong> — raw session records
                streamed in by each robot&apos;s Datadog agent.
              </li>
              <li>
                <strong>/api/metrics/backfill</strong> — admin-only endpoint
                that queries BQ for any date range and upserts into{" "}
                <code className="text-[12px]">daily_metrics</code>. Run
                manually when configs change (e.g. you just bumped POH from 2
                to 4 hrs/day; re-running the backfill recalculates util_pct
                for every existing row).
              </li>
              <li>
                <strong>daily_metrics (Neon Postgres)</strong> — one row per
                (sn, date). Read by every chart and table on this page via{" "}
                <code className="text-[12px]">/api/metrics</code>.
              </li>
              <li>
                <strong>Phase 3 cron (coming):</strong> nightly auto-run of
                the backfill for yesterday&apos;s date. Until that ships, you
                need to manually trigger backfill to pick up new data.
              </li>
            </ol>
          </div>

          {/* Available hours table */}
          <div>
            <h3 className="font-semibold mt-3 mb-1">
              Available hours per day, by site
            </h3>
            <p className="text-muted text-[13px] mb-2">
              The denominator for utilization. Edit in{" "}
              <code className="text-[12px]">lib/sites-config.ts</code> and
              re-run the backfill to recalculate.
            </p>
            <div className="overflow-x-auto">
              <table className="text-[13px] border border-line rounded-md">
                <thead className="bg-cream/40">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">Site</th>
                    <th className="text-right px-3 py-1.5 font-medium">
                      Avail hrs/day
                    </th>
                  </tr>
                </thead>
                <tbody className="text-ink">
                  {SITES.map((s) => (
                    <tr key={s.name} className="border-t border-line">
                      <td className="px-3 py-1">{s.name}</td>
                      <td className="px-3 py-1 text-right tabular-nums">
                        {s.availableHrsPerDay}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Gotchas */}
          <div>
            <h3 className="font-semibold mt-3 mb-1">Known gotchas</h3>
            <ul className="text-muted text-[13px] ml-5 list-disc space-y-1">
              <li>
                <strong>Cross-midnight sessions:</strong> a session starting
                11pm Mon and ending 3am Tue is counted entirely on Monday
                (the start date). For typical shift patterns this is &lt; 1%
                error.
              </li>
              <li>
                <strong>Days with no data render blank,</strong> not 0%. The
                table cell is &ldquo;—&rdquo;. If a robot is scheduled but
                has zero sessions, that&apos;s genuinely missing — likely a
                non-production day or a robot that wasn&apos;t powered on.
              </li>
              <li>
                <strong>Util &gt;&gt; 100% almost always means BQ data
                quality:</strong> overlapping sessions, stuck agents, or
                mislabeled sessions. The 16-hour filter catches the worst,
                but extreme values (300%+) deserve investigation in BQ.
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---- KPI card ------------------------------------------------------------
function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="text-2xl font-semibold text-ink mt-1 tabular-nums">
        {value}
      </div>
      <div className="text-[11px] text-muted mt-1">{sub}</div>
    </div>
  );
}

// ---- LineChart (inline SVG, no dep) --------------------------------------
const SITE_COLORS = [
  "#ea580c", // orange
  "#0891b2", // cyan
  "#7c3aed", // purple
  "#16a34a", // green
  "#db2777", // pink
  "#0284c7", // sky
  "#ca8a04", // amber-dark
  "#475569", // slate
];

function LineChart({
  buckets,
  matrix,
  sites,
  metric,
  yMax,
}: {
  buckets: string[];
  matrix: Map<string, Map<string, RollupRow>>;
  sites: string[];
  metric: "utilPctAvg" | "uptimePctAvg";
  yMax: number;
}) {
  const W = 800;
  const H = 280;
  const padL = 40;
  const padR = 16;
  const padT = 12;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  if (buckets.length === 0 || sites.length === 0) {
    return (
      <div className="text-muted text-sm py-6 text-center">
        No data for this range.
      </div>
    );
  }

  // x position for each bucket (evenly spaced)
  const xFor = (i: number) =>
    padL + (buckets.length === 1 ? plotW / 2 : (i * plotW) / (buckets.length - 1));
  const yFor = (v: number) => padT + plotH - (Math.min(v, yMax) / yMax) * plotH;

  // y-axis grid lines at 25/50/75/100/yMax
  const yTicks = [0, 25, 50, 75, 100];
  if (yMax > 100) yTicks.push(yMax);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 600 }}
      >
        {/* Y-axis grid */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W - padR}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="currentColor"
              strokeOpacity="0.08"
            />
            <text
              x={padL - 4}
              y={yFor(t) + 4}
              textAnchor="end"
              fontSize="10"
              fill="currentColor"
              opacity="0.5"
            >
              {t}%
            </text>
          </g>
        ))}

        {/* X-axis labels — every Nth bucket for readability */}
        {buckets.map((b, i) => {
          const step = Math.ceil(buckets.length / 10);
          if (i % step !== 0 && i !== buckets.length - 1) return null;
          return (
            <text
              key={b}
              x={xFor(i)}
              y={H - padB + 16}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
              opacity="0.6"
            >
              {b.length > 7 ? b.slice(5) : b}
            </text>
          );
        })}

        {/* Lines */}
        {sites.map((site, si) => {
          const color = SITE_COLORS[si % SITE_COLORS.length];
          const points = buckets
            .map((b, i) => {
              const cell = matrix.get(site)?.get(b);
              const v =
                cell && cell[metric] !== null && cell[metric] !== undefined
                  ? (cell[metric] as number)
                  : null;
              return v === null ? null : { x: xFor(i), y: yFor(v) };
            })
            .filter((p): p is { x: number; y: number } => p !== null);
          if (points.length === 0) return null;
          const path = points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
            .join(" ");
          return (
            <g key={site}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              {points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="2" fill={color} />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2">
        {sites.map((site, si) => (
          <div key={site} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: SITE_COLORS[si % SITE_COLORS.length] }}
            />
            <span className="text-muted">{site}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
