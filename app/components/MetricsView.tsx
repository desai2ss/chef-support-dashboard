"use client";

// Metrics tab — Util %, Uptime %, Total Servings over a selected date range.
// Phase 1: read-only. Backed by /api/metrics (rollup) and seeded by the
// admin endpoint /api/metrics/backfill.

import { useEffect, useMemo, useState } from "react";
import { SITES, isDayScheduled } from "@/lib/sites-config";
import { ROBOTS } from "@/lib/fleet-config";

type RollupRow = {
  bucket: string; // YYYY-MM-DD | YYYY-Wxx | YYYY-MM
  site: string;
  utilPctAvg: number | null;
  uptimePctAvg: number | null;
  servingsSum: number | null;
  hoursSum: number | null;
  robotsCount: number;
};

type DailyRow = {
  sn: number;
  date: string;
  site: string;
  utilPct: number | null;
  productionHours: number | null;
  uptimePct: number | null;
  servings: number | null;
  uptimePylonTicket: string | null;
  uptimeNote: string | null;
};

type ApiResponse = {
  ok?: boolean;
  grain: "day" | "week" | "month";
  from: string;
  to: string;
  site: string | null;
  rows: RollupRow[];
  daily?: DailyRow[];
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

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Parse a YYYY-MM-DD string into a local-time Date (so day-of-week isn't UTC-shifted).
function parseDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Format a "bucket" identifier returned by /api/metrics for a header label.
// Returns { line1, line2 } so headers can stack day-name on top of m/d.
function formatBucket(
  bucket: string,
  grain: "day" | "week" | "month"
): { line1: string; line2: string } {
  if (grain === "day" && /^\d{4}-\d{2}-\d{2}$/.test(bucket)) {
    const d = parseDate(bucket);
    return {
      line1: DAY_NAMES[d.getDay()],
      line2: `${d.getMonth() + 1}/${d.getDate()}`,
    };
  }
  if (grain === "week") {
    const m = bucket.match(/^(\d{4})-W(\d+)$/);
    if (m) return { line1: `W${parseInt(m[2], 10)}`, line2: m[1] };
    return { line1: bucket, line2: "" };
  }
  if (grain === "month") {
    const m = bucket.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const monthIdx = parseInt(m[2], 10) - 1;
      return {
        line1: MONTH_NAMES[monthIdx] ?? m[2],
        line2: m[1].slice(2),
      };
    }
    return { line1: bucket, line2: "" };
  }
  return { line1: bucket, line2: "" };
}

// ---- presets -------------------------------------------------------------
type Preset = { label: string; days?: number; ytd?: boolean };
const PRESETS: Preset[] = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 180 days", days: 180 },
  { label: "YTD", ytd: true },
];

type Grain = "day" | "week" | "month";

function grainAdverb(g: Grain): string {
  return g === "day" ? "daily" : g === "week" ? "weekly" : "monthly";
}

// ---- CSV download --------------------------------------------------------
// Build a CSV from the current rollup + per-robot daily data. Two sheets
// concatenated into one CSV (separated by a blank row + section header).
function buildCsv(args: {
  from: string;
  to: string;
  grain: Grain;
  siteFilter: string | null;
  rows: RollupRow[];
  daily: DailyRow[];
}): string {
  const { from, to, grain, siteFilter, rows, daily } = args;
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\n") || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines: string[] = [];

  // Header metadata
  lines.push(`Chef Robotics Metrics Export`);
  lines.push(`Date range,${esc(from)},${esc(to)}`);
  lines.push(`Grain,${esc(grain)}`);
  lines.push(`Site filter,${esc(siteFilter ?? "All sites")}`);
  lines.push("");

  // Section 1: rollup table (sites × buckets)
  lines.push(`# Aggregated by site × ${grain}`);
  lines.push(
    [
      "Bucket",
      "Site",
      "Util % (avg)",
      "Uptime % (avg)",
      "Servings (sum)",
      "Robots reported",
    ]
      .map(esc)
      .join(",")
  );
  for (const r of rows) {
    const util = Number(r.utilPctAvg);
    const up = Number(r.uptimePctAvg);
    const serv = Number(r.servingsSum ?? 0);
    lines.push(
      [
        r.bucket,
        r.site,
        Number.isFinite(util) ? util.toFixed(2) : "",
        Number.isFinite(up) ? up.toFixed(2) : "",
        Number.isFinite(serv) ? Math.round(serv) : "",
        Number(r.robotsCount ?? 0),
      ]
        .map(esc)
        .join(",")
    );
  }

  // Section 2: per-robot daily rows (only present when grain=day & site filter)
  if (daily.length > 0) {
    lines.push("");
    lines.push(`# Per-robot daily detail`);
    lines.push(
      [
        "Date",
        "SN",
        "Site",
        "Util %",
        "Production hours",
        "Uptime %",
        "Servings",
        "Pylon ticket",
        "Uptime note",
      ]
        .map(esc)
        .join(",")
    );
    for (const d of daily) {
      lines.push(
        [
          d.date,
          d.sn,
          d.site,
          d.utilPct != null ? d.utilPct.toFixed(2) : "",
          d.productionHours != null ? d.productionHours.toFixed(2) : "",
          d.uptimePct != null ? d.uptimePct.toFixed(2) : "",
          d.servings ?? "",
          d.uptimePylonTicket ?? "",
          d.uptimeNote ?? "",
        ]
          .map(esc)
          .join(",")
      );
    }
  }
  return lines.join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
  const [refreshKey, setRefreshKey] = useState(0); // bump to refetch
  // Cell selection state for the per-robot daily editor.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<{ sn: number; date: string } | null>(
    null
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBanner, setEditorBanner] = useState<string | null>(null);

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
  }, [from, to, grain, siteFilter, refreshKey]);

  // Clear selection when the user switches view / filter.
  useEffect(() => {
    setSelected(new Set());
    setAnchor(null);
  }, [grain, siteFilter, from, to]);

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
        const u = Number(r.utilPctAvg);
        if (Number.isFinite(u)) {
          utilSum += u;
          utilN += 1;
        }
        const up = Number(r.uptimePctAvg);
        if (Number.isFinite(up)) {
          uptimeSum += up;
          uptimeN += 1;
        }
        // Postgres returns SUM() as a string in node-postgres; coerce.
        servings += Number(r.servingsSum ?? 0);
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
    if (p.ytd) {
      const jan1 = new Date(today.getFullYear(), 0, 1);
      setFrom(fmtDate(jan1));
      setTo(fmtDate(today));
      return;
    }
    if (typeof p.days === "number") {
      setFrom(fmtDate(addDays(today, -p.days)));
      setTo(fmtDate(today));
    }
  }

  function handleDownload() {
    if (!data) return;
    const fname =
      "chef-metrics_" +
      from +
      "_to_" +
      to +
      "_" +
      grain +
      (siteFilter
        ? "_" + siteFilter.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
        : "") +
      ".csv";
    const csv = buildCsv({
      from,
      to,
      grain,
      siteFilter: siteFilter || null,
      rows: data.rows ?? [],
      daily: data.daily ?? [],
    });
    downloadCsv(fname, csv);
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
              {SITES.filter((s) => !s.excludeFromMetrics).map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1 ml-auto items-end">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="text-xs px-2 py-1 rounded-md border border-line bg-card hover:bg-cream"
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={handleDownload}
              disabled={!data || loading}
              className="text-xs px-3 py-1 rounded-md bg-ink text-cream font-medium hover:opacity-90 disabled:opacity-50 ml-1"
              title="Download the current view (date range + grain + site filter) as a CSV file. Open in Google Sheets via File → Import → Upload."
            >
              ⬇ Download CSV
            </button>
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
          sub="sum of bowl_count across PRODUCTION sessions"
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
              ? `${siteFilter} — ${grainAdverb(grain)}`
              : `All sites — ${grainAdverb(grain)} utilization %`}
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
                {buckets.map((b) => {
                  const f = formatBucket(b, grain);
                  return (
                    <th
                      key={b}
                      className="text-right py-2 px-2 font-medium"
                      title={b}
                    >
                      <div className="leading-tight">{f.line1}</div>
                      {f.line2 ? (
                        <div className="font-normal normal-case text-muted text-[10px] leading-tight">
                          {f.line2}
                        </div>
                      ) : null}
                    </th>
                  );
                })}
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
                    const isDayBucket =
                      grain === "day" && /^\d{4}-\d{2}-\d{2}$/.test(b);
                    // Non-scheduled days ALWAYS show "—", even if a robot
                    // happened to run that day. The dash means "not a
                    // production day per the site's schedule."
                    if (isDayBucket && !isDayScheduled(site, b)) {
                      return (
                        <td
                          key={b}
                          className="py-2 px-2 text-right text-muted/30"
                          title="Not a scheduled run day"
                        >
                          —
                        </td>
                      );
                    }
                    if (!cell || cell.utilPctAvg === null) {
                      if (isDayBucket) {
                        return (
                          <td
                            key={b}
                            className="py-2 px-2 text-right text-muted tabular-nums"
                            title="Scheduled run day — no BQ data (robots off / not reporting)"
                          >
                            0%
                          </td>
                        );
                      }
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

      {/* Pivot table — site × bucket — SERVINGS */}
      <section className="mt-5 rounded-xl border border-line bg-card p-5">
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="text-base font-semibold">
            {siteFilter
              ? `${siteFilter} — ${grainAdverb(grain)} servings`
              : `All sites — ${grainAdverb(grain)} servings`}
          </h2>
          <span className="text-xs text-muted">
            {from} – {to} · grand total{" "}
            <span className="text-ink font-medium">
              {totalServings.toLocaleString()}
            </span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left py-2 px-2 sticky left-0 bg-card font-medium">
                  Site
                </th>
                {buckets.map((b) => {
                  const f = formatBucket(b, grain);
                  return (
                    <th
                      key={b}
                      className="text-right py-2 px-2 font-medium"
                      title={b}
                    >
                      <div className="leading-tight">{f.line1}</div>
                      {f.line2 ? (
                        <div className="font-normal normal-case text-muted text-[10px] leading-tight">
                          {f.line2}
                        </div>
                      ) : null}
                    </th>
                  );
                })}
                <th className="text-right py-2 px-2 font-medium border-l border-line">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sitesShown.map((site) => {
                let rowTotal = 0;
                return (
                  <tr key={site} className="border-t border-line">
                    <td className="py-2 px-2 sticky left-0 bg-card text-ink font-medium">
                      {site}
                    </td>
                    {buckets.map((b) => {
                      const cell = matrix.get(site)?.get(b);
                      const isDayBucket =
                        grain === "day" &&
                        /^\d{4}-\d{2}-\d{2}$/.test(b);
                      // Non-scheduled days: always dash.
                      if (isDayBucket && !isDayScheduled(site, b)) {
                        return (
                          <td
                            key={b}
                            className="py-2 px-2 text-right text-muted/30"
                            title="Not a scheduled run day"
                          >
                            —
                          </td>
                        );
                      }
                      const v = Number(cell?.servingsSum ?? 0);
                      rowTotal += v;
                      if (!cell || v === 0) {
                        if (isDayBucket) {
                          return (
                            <td
                              key={b}
                              className="py-2 px-2 text-right text-muted tabular-nums"
                              title="Scheduled day — no production reported"
                            >
                              0
                            </td>
                          );
                        }
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
                          {v.toLocaleString()}
                        </td>
                      );
                    })}
                    <td className="py-2 px-2 text-right text-ink font-medium tabular-nums border-l border-line">
                      {rowTotal.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {/* Column totals row */}
              <tr className="border-t-2 border-line/80">
                <td className="py-2 px-2 sticky left-0 z-10 bg-card text-ink font-semibold text-[11px] uppercase tracking-wider">
                  Total
                </td>
                {buckets.map((b) => {
                  let colTotal = 0;
                  for (const site of sitesShown) {
                    const cell = matrix.get(site)?.get(b);
                    colTotal += Number(cell?.servingsSum ?? 0);
                  }
                  return (
                    <td
                      key={b}
                      className="py-2 px-2 text-right text-ink font-semibold tabular-nums bg-cream/30"
                    >
                      {colTotal > 0 ? colTotal.toLocaleString() : "—"}
                    </td>
                  );
                })}
                <td className="py-2 px-2 text-right text-ink font-bold tabular-nums border-l border-line bg-cream/30">
                  {totalServings.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-robot daily uptime editor — only when grain=day AND site is selected */}
      {grain === "day" && siteFilter ? (
        <>
          <PerRobotUtil
            site={siteFilter}
            from={from}
            to={to}
            daily={data?.daily ?? []}
          />
          <PerRobotEditor
            site={siteFilter}
            from={from}
            to={to}
            daily={data?.daily ?? []}
            editor={editor}
            selected={selected}
            setSelected={setSelected}
            anchor={anchor}
            setAnchor={setAnchor}
            onEdit={() => setEditorOpen(true)}
            banner={editorBanner}
          />
        </>
      ) : null}

      {/* Edit Downtime modal */}
      {editorOpen ? (
        <EditDowntimeModal
          selectedKeys={selected}
          onClose={() => setEditorOpen(false)}
          onSaved={(msg) => {
            setEditorOpen(false);
            setEditorBanner(msg);
            setSelected(new Set());
            setRefreshKey((k) => k + 1);
            setTimeout(() => setEditorBanner(null), 5000);
          }}
        />
      ) : null}

      {/* Methodology — explains exactly how every number is calculated */}
      <MethodologySection />
    </div>
  );
}

// ---- Per-robot daily utilization (read-only, mirrors PerRobotEditor layout)
function PerRobotUtil({
  site,
  from,
  to,
  daily,
}: {
  site: string;
  from: string;
  to: string;
  daily: DailyRow[];
}) {
  const dates = useMemo(() => {
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
  }, [from, to]);

  const robots = useMemo(
    () => ROBOTS.filter((r) => r.site === site).sort((a, b) => a.sn - b.sn),
    [site]
  );

  const cellMap = useMemo(() => {
    const m = new Map<string, DailyRow>();
    for (const d of daily) m.set(`${d.sn}|${d.date}`, d);
    return m;
  }, [daily]);

  function utilCellStyle(
    utilPct: number | null | undefined,
    scheduled: boolean,
    hasRow: boolean
  ): string {
    if (!scheduled) return "bg-card text-muted/30";
    if (!hasRow || utilPct == null) return "bg-cream/30 text-muted";
    if (utilPct >= 80) return "bg-emerald-50 text-emerald-900";
    if (utilPct >= 50) return "bg-amber-50 text-amber-900";
    return "bg-red-50 text-red-900";
  }

  return (
    <section className="mb-5 rounded-xl border border-line bg-card p-5">
      <div className="flex justify-between items-end mb-3 flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">
            Per-robot daily utilization — {site}
          </h2>
          <div className="text-xs text-muted mt-0.5">
            Util % per (robot, day). Read-only — to edit a robot&apos;s
            downtime, use the uptime editor below.
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted">
              <th className="text-left py-2 px-2 sticky left-0 bg-card font-medium">
                Robot
              </th>
              {dates.map((d) => {
                const f = formatBucket(d, "day");
                return (
                  <th
                    key={d}
                    className="text-center py-2 px-1 font-medium"
                    title={d}
                  >
                    <div className="leading-tight">{f.line1}</div>
                    <div className="font-normal normal-case text-muted text-[10px] leading-tight tabular-nums">
                      {f.line2}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {robots.map((r) => (
              <tr key={r.sn} className="border-t border-line">
                <td className="py-1 px-2 sticky left-0 bg-card text-ink font-medium whitespace-nowrap">
                  SN{r.sn}{" "}
                  <span className="text-muted">
                    {r.nickname}
                    {r.spare ? " · spare" : ""}
                  </span>
                </td>
                {dates.map((d) => {
                  const row = cellMap.get(`${r.sn}|${d}`);
                  const scheduled = isDayScheduled(site, d);
                  const utilPct = row?.utilPct;
                  return (
                    <td
                      key={d}
                      className={
                        "py-1 px-1 text-center align-middle border-l border-line/40 " +
                        utilCellStyle(utilPct, scheduled, !!row)
                      }
                      title={
                        !scheduled
                          ? row
                            ? `Not a scheduled run day (robot reported ${row.productionHours?.toFixed(1) ?? "?"}h anyway)`
                            : "Not a scheduled run day"
                          : row
                            ? [
                                utilPct != null
                                  ? `util ${utilPct.toFixed(0)}%`
                                  : "no util data",
                                row.productionHours != null
                                  ? `${row.productionHours.toFixed(1)}h production`
                                  : null,
                                row.servings != null && row.servings > 0
                                  ? `${row.servings.toLocaleString()} servings`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : "Scheduled — no BQ data"
                      }
                    >
                      {!scheduled ? (
                        <div className="text-[11px] text-muted/40">—</div>
                      ) : row && utilPct != null ? (
                        <div className="tabular-nums text-[11px]">
                          {utilPct.toFixed(0)}
                        </div>
                      ) : (
                        <div className="tabular-nums text-[11px]">0</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11px] text-muted">
        Legend:{" "}
        <span className="px-1 bg-emerald-50 text-emerald-900">&ge; 80</span>{" "}
        healthy ·{" "}
        <span className="px-1 bg-amber-50 text-amber-900">50-79</span> partial ·{" "}
        <span className="px-1 bg-red-50 text-red-900">&lt; 50</span> low ·{" "}
        <span className="bg-cream/30 px-1">0</span> scheduled, no data ·{" "}
        <span className="text-muted/40">—</span> not a scheduled run day
      </div>
    </section>
  );
}

// ---- Per-robot daily editor (selection + Edit-downtime button) -----------
function PerRobotEditor({
  site,
  from,
  to,
  daily,
  editor,
  selected,
  setSelected,
  anchor,
  setAnchor,
  onEdit,
  banner,
}: {
  site: string;
  from: string;
  to: string;
  daily: DailyRow[];
  editor: boolean;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  anchor: { sn: number; date: string } | null;
  setAnchor: (a: { sn: number; date: string } | null) => void;
  onEdit: () => void;
  banner: string | null;
}) {
  // Build list of all dates in the range (YYYY-MM-DD strings)
  const dates = useMemo(() => {
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
  }, [from, to]);

  // Robots at this site (from fleet-config — always shows full roster even
  // if some have no BQ rows). Sorted by SN.
  const robots = useMemo(
    () => ROBOTS.filter((r) => r.site === site).sort((a, b) => a.sn - b.sn),
    [site]
  );

  // (sn|date) -> DailyRow lookup
  const cellMap = useMemo(() => {
    const m = new Map<string, DailyRow>();
    for (const d of daily) m.set(`${d.sn}|${d.date}`, d);
    return m;
  }, [daily]);

  function cellKey(sn: number, date: string) {
    return `${sn}|${date}`;
  }

  function handleCellClick(
    sn: number,
    date: string,
    e: React.MouseEvent
  ) {
    if (!editor) return;
    const k = cellKey(sn, date);
    const next = new Set(selected);
    if (e.shiftKey && anchor) {
      // Range select: rectangle from anchor (sn, date) to (sn, date)
      const snList = robots.map((r) => r.sn);
      const snStart = snList.indexOf(anchor.sn);
      const snEnd = snList.indexOf(sn);
      const dStart = dates.indexOf(anchor.date);
      const dEnd = dates.indexOf(date);
      if (snStart >= 0 && snEnd >= 0 && dStart >= 0 && dEnd >= 0) {
        const sMin = Math.min(snStart, snEnd);
        const sMax = Math.max(snStart, snEnd);
        const dMin = Math.min(dStart, dEnd);
        const dMax = Math.max(dStart, dEnd);
        next.clear();
        for (let i = sMin; i <= sMax; i++) {
          for (let j = dMin; j <= dMax; j++) {
            next.add(cellKey(snList[i], dates[j]));
          }
        }
      }
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle add/remove
      if (next.has(k)) next.delete(k);
      else next.add(k);
      setAnchor({ sn, date });
    } else {
      // Single
      next.clear();
      next.add(k);
      setAnchor({ sn, date });
    }
    setSelected(next);
  }

  function clearSelection() {
    setSelected(new Set());
    setAnchor(null);
  }

  function selectAllDowntime() {
    const next = new Set<string>();
    for (const d of daily) {
      if ((d.uptimePct ?? 100) < 100) next.add(cellKey(d.sn, d.date));
    }
    setSelected(next);
  }

  // Visual style for a cell. Uptime defaults to 100% — if there's no row
  // for a scheduled day, treat it as full uptime (emerald) rather than
  // "no data" grey. The dash is reserved for non-scheduled days only.
  function cellStyle(
    row: DailyRow | undefined,
    scheduled: boolean
  ): string {
    if (!scheduled) return "bg-card text-muted/30";
    const u = row?.uptimePct ?? 100;
    if (u >= 100) return "bg-emerald-50 text-emerald-900";
    if (u >= 75) return "bg-amber-50 text-amber-900";
    return "bg-red-50 text-red-900";
  }

  return (
    <section className="mb-5 rounded-xl border border-line bg-card p-5">
      <div className="flex justify-between items-end mb-3 flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold">
            Per-robot daily uptime — {site}
          </h2>
          <div className="text-xs text-muted mt-0.5">
            {editor ? (
              <>
                Click a cell to select it. <strong>Shift+click</strong> for
                rectangular range. <strong>⌘/Ctrl+click</strong> to
                add/remove individual cells. Then click <em>Edit downtime</em>
                .
              </>
            ) : (
              <>
                Read-only — only editors can change uptime. Cells below 100%
                show the linked Pylon ticket.
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 ? (
            <>
              <span className="text-xs text-muted">
                {selected.size} cell{selected.size === 1 ? "" : "s"} selected
              </span>
              <button
                onClick={clearSelection}
                className="text-xs px-2 py-1 rounded-md border border-line bg-card hover:bg-cream"
              >
                Clear
              </button>
              <button
                onClick={onEdit}
                disabled={!editor}
                className={
                  "text-xs px-3 py-1 rounded-md font-medium " +
                  (editor
                    ? "bg-ink text-cream hover:opacity-90"
                    : "bg-cream text-muted cursor-not-allowed")
                }
              >
                Edit downtime
              </button>
            </>
          ) : (
            <button
              onClick={selectAllDowntime}
              disabled={!editor}
              className={
                "text-xs px-2 py-1 rounded-md border border-line " +
                (editor
                  ? "bg-card hover:bg-cream"
                  : "bg-cream text-muted cursor-not-allowed")
              }
              title="Select all cells already marked down (uptime &lt; 100%)"
            >
              Select existing downtime
            </button>
          )}
        </div>
      </div>

      {banner ? (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {banner}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted">
              <th className="text-left py-2 px-2 sticky left-0 bg-card font-medium">
                Robot
              </th>
              {dates.map((d) => {
                const f = formatBucket(d, "day");
                return (
                  <th
                    key={d}
                    className="text-center py-2 px-1 font-medium"
                    title={d}
                  >
                    <div className="leading-tight">{f.line1}</div>
                    <div className="font-normal normal-case text-muted text-[10px] leading-tight tabular-nums">
                      {f.line2}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {robots.map((r) => (
              <tr key={r.sn} className="border-t border-line">
                <td className="py-1 px-2 sticky left-0 bg-card text-ink font-medium whitespace-nowrap">
                  SN{r.sn}{" "}
                  <span className="text-muted">
                    {r.nickname}
                    {r.spare ? " · spare" : ""}
                  </span>
                </td>
                {dates.map((d) => {
                  const k = cellKey(r.sn, d);
                  const row = cellMap.get(k);
                  const isSelected = selected.has(k);
                  const scheduled = isDayScheduled(site, d);
                  const u = row?.uptimePct ?? 100;
                  const hasDowntime = u < 100;
                  // Three display modes:
                  //   row exists  → uptime % (color-coded)
                  //   no row, scheduled    → "0" (scheduled but no data)
                  //   no row, not scheduled → "—" (off day)
                  return (
                    <td
                      key={d}
                      onClick={(e) => {
                        // Allow selection even on non-scheduled days so
                        // editors can manually log a downtime on those if
                        // needed, but visually dim.
                        handleCellClick(r.sn, d, e);
                      }}
                      className={
                        "py-1 px-1 text-center align-middle border-l border-line/40 select-none " +
                        (editor ? "cursor-pointer hover:brightness-95 " : "") +
                        cellStyle(row, scheduled) +
                        " " +
                        (isSelected
                          ? "ring-2 ring-inset ring-blue-500 z-10 relative"
                          : "")
                      }
                      title={
                        !scheduled
                          ? row
                            ? `Not a scheduled run day (robot reported ${row.productionHours?.toFixed(1) ?? "?"}h anyway)`
                            : "Not a scheduled run day"
                          : row
                            ? [
                                row.utilPct != null
                                  ? `util ${row.utilPct.toFixed(0)}%`
                                  : "no util data",
                                row.productionHours != null
                                  ? `${row.productionHours.toFixed(1)}h production`
                                  : null,
                                `uptime ${u.toFixed(0)}%`,
                                row.uptimePylonTicket
                                  ? `ticket #${row.uptimePylonTicket}`
                                  : null,
                                row.uptimeNote
                                  ? `note: ${row.uptimeNote}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : "Scheduled run day — no BQ data (robot off / not reporting)"
                      }
                    >
                      {!scheduled ? (
                        <div className="text-[11px] text-muted/40">—</div>
                      ) : (
                        // Uptime defaults to 100% on scheduled days even when
                        // no daily_metrics row exists. u = row?.uptimePct ?? 100.
                        <>
                          <div className="tabular-nums text-[11px]">
                            {u.toFixed(0)}
                          </div>
                          {hasDowntime && row?.uptimePylonTicket ? (
                            <div className="text-[9px] text-muted leading-tight">
                              #{row.uptimePylonTicket}
                            </div>
                          ) : null}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11px] text-muted">
        Legend: <span className="px-1 bg-emerald-50 text-emerald-900">100</span>{" "}
        full uptime (default on every scheduled day) ·{" "}
        <span className="px-1 bg-amber-50 text-amber-900">75-99</span> partial
        downtime ·{" "}
        <span className="px-1 bg-red-50 text-red-900">&lt; 75</span> major
        downtime · <span className="text-muted/40">—</span> not a scheduled
        run day
      </div>
    </section>
  );
}

// ---- Edit Downtime modal -------------------------------------------------
function EditDowntimeModal({
  selectedKeys,
  onClose,
  onSaved,
}: {
  selectedKeys: Set<string>;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [uptimePct, setUptimePct] = useState<string>("0");
  const [pylonTicket, setPylonTicket] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cells = useMemo(
    () =>
      Array.from(selectedKeys).map((k) => {
        const [sn, date] = k.split("|");
        return { sn: Number(sn), date };
      }),
    [selectedKeys]
  );

  async function save() {
    setErr(null);
    const u = Number(uptimePct);
    if (!Number.isFinite(u) || u < 0 || u > 100) {
      setErr("Uptime % must be a number from 0 to 100");
      return;
    }
    if (u < 100 && !pylonTicket.trim()) {
      setErr(
        "A Pylon ticket # is required for any downtime entry. Type the issue number (e.g. 1234)."
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/metrics/uptime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cells,
          uptimePct: u,
          pylonTicket: pylonTicket.trim() || null,
          note: note.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (HTTP ${res.status})`);
        setSaving(false);
        return;
      }
      const ticketLabel = pylonTicket.trim()
        ? ` (ticket #${pylonTicket.trim()}${j.ticketTitle ? ` — ${j.ticketTitle}` : ""})`
        : "";
      onSaved(`Updated ${j.rowsAffected} cells${ticketLabel}.`);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setSaving(false);
    }
  }

  // Quick presets so common downtime is one click
  const presets = [
    { label: "0% (full day)", value: 0 },
    { label: "25%", value: 25 },
    { label: "50%", value: 50 },
    { label: "75%", value: 75 },
    { label: "100% (clear)", value: 100 },
  ];

  return (
    <div
      className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl border border-line shadow-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-1">Edit downtime</h3>
        <p className="text-xs text-muted mb-4">
          Applying to {cells.length} cell{cells.length === 1 ? "" : "s"}. All
          cells get the same uptime %, ticket, and note. Edit cells separately
          if they have different root causes.
        </p>

        <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
          Uptime % (0 = full day down, 100 = no downtime)
        </label>
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          value={uptimePct}
          onChange={(e) => setUptimePct(e.target.value)}
          className="w-full bg-card border border-line rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-zinc-400 mb-2"
        />
        <div className="flex gap-1 mb-4 flex-wrap">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => setUptimePct(String(p.value))}
              className="text-xs px-2 py-1 rounded-md border border-line bg-card hover:bg-cream"
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
          Pylon ticket # {uptimePct !== "100" ? "(required)" : "(optional)"}
        </label>
        <input
          type="text"
          inputMode="numeric"
          value={pylonTicket}
          onChange={(e) => setPylonTicket(e.target.value)}
          placeholder="e.g. 1234"
          className="w-full bg-card border border-line rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-zinc-400 mb-4"
        />

        <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Short context shown on hover…"
          className="w-full bg-card border border-line rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-zinc-400 mb-4"
        />

        {err ? (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {err}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm px-3 py-1.5 rounded-md border border-line bg-card hover:bg-cream"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-sm px-4 py-1.5 rounded-md bg-ink text-cream font-medium hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
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
                Weekly / monthly buckets are computed as the{" "}
                <strong>average of daily averages</strong> (not row-weighted).
                So if Mon had 3 robots reporting at 80% and Tue had 5 robots
                at 20%, the weekly cell shows (80 + 20) / 2 = 50% — matching
                the &ldquo;typical day in this period&rdquo; intuition rather
                than weighting toward days with more reports.
              </li>
              <li>
                Empty scheduled days (a scheduled run day with zero BQ
                production data) count as{" "}
                <strong>0% util in the average</strong>. So a 5-day week with
                only 3 days of real data, each at 100%, shows weekly util ={" "}
                (100+100+100+0+0) / 5 = <strong>60%</strong>, not 100%. The
                math matches what&apos;s visually shown in the daily cells.
              </li>
            </ul>
          </div>

          {/* Why grains differ */}
          <div>
            <h3 className="font-semibold mt-3 mb-1">
              Why day, week, and month numbers don&apos;t exactly match
            </h3>
            <p className="text-muted">
              Each grain aggregates differently — they&apos;re mathematically
              different views of the same underlying data:
            </p>
            <ul className="text-muted text-[13px] mt-1 ml-5 list-disc space-y-1">
              <li>
                <strong>Day cell</strong>: avg of robot util on that single
                day, for that site.
              </li>
              <li>
                <strong>Week cell</strong>: avg of that site&apos;s 5-7 daily
                values for the week (empty days = 0%).
              </li>
              <li>
                <strong>Month cell</strong>: avg of that site&apos;s ~22 daily
                values for the month (empty days = 0%).
              </li>
              <li>
                <strong>Fleet KPI</strong>: avg of every (site × bucket) cell
                visible in the pivot. With grain=day over 30 days × 8 sites,
                that&apos;s 240 cells averaged. With grain=month it&apos;s
                ~8 cells. Because each higher-grain cell is itself an average
                of multiple days, the math doesn&apos;t exactly equal a flat
                mean of all daily values — different weighting.
              </li>
              <li>
                <strong>Servings (sum)</strong>:{" "}
                <em>does</em> match exactly across grains — sum is
                associative, so day-total = week-total summed = month-total
                summed for the same range.
              </li>
            </ul>
            <p className="text-muted text-[13px] mt-2">
              If you want a single &ldquo;overall utilization for this date
              range&rdquo; that doesn&apos;t change as you switch grain, drop
              to grain=day and look at the KPI — that&apos;s the most direct
              flat mean.
            </p>
          </div>

          {/* Compared to Retool */}
          <div>
            <h3 className="font-semibold mt-3 mb-1">
              How this differs from Retool&apos;s Daily Production Summary
            </h3>
            <p className="text-muted">
              We pull from the same BigQuery table (
              <code className="text-[12px]">
                coremetrics_staging.sessions_v0
              </code>
              ), so it&apos;s the same raw data — but the numbers won&apos;t
              be identical because of filter and bucketing choices:
            </p>
            <div className="overflow-x-auto mt-2">
              <table className="text-[12px] border border-line rounded-md">
                <thead className="bg-cream/40">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">Aspect</th>
                    <th className="text-left px-3 py-1.5 font-medium">
                      This dashboard
                    </th>
                    <th className="text-left px-3 py-1.5 font-medium">
                      Retool
                    </th>
                  </tr>
                </thead>
                <tbody className="text-ink">
                  <tr className="border-t border-line">
                    <td className="px-3 py-1 font-medium">Source column for servings</td>
                    <td className="px-3 py-1">
                      <code>sessions_v0.bowl_count</code>
                    </td>
                    <td className="px-3 py-1">
                      <code>sessions_v0.bowl_count</code>
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1 font-medium">Util % shown?</td>
                    <td className="px-3 py-1">
                      Yes: <code>prod_hrs / availHrs × 100</code>
                    </td>
                    <td className="px-3 py-1">
                      No — Retool shows &ldquo;Modules Active Time (hr)&rdquo;
                      instead
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1 font-medium">Session filter</td>
                    <td className="px-3 py-1">
                      <code>label = &apos;PRODUCTION&apos;</code>
                    </td>
                    <td className="px-3 py-1">
                      <code>label = &apos;PRODUCTION&apos;</code> AND{" "}
                      <code>session_state IN (&apos;completed&apos;, &apos;failed&apos;)</code>
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1 font-medium">Production day boundary</td>
                    <td className="px-3 py-1">
                      Customer-local <strong>2:00am</strong> — sessions from
                      2am Mon to 1:59am Tue all attribute to Monday
                    </td>
                    <td className="px-3 py-1">
                      Customer-local <strong>midnight</strong>
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1 font-medium">Non-scheduled days</td>
                    <td className="px-3 py-1">
                      Excluded entirely (off-days render as &ldquo;—&rdquo;,
                      no contribution to averages)
                    </td>
                    <td className="px-3 py-1">
                      Included if data exists
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1 font-medium">
                      Stuck-session protection
                    </td>
                    <td className="px-3 py-1">
                      Per-site cap: each session &le;{" "}
                      <code>availHrs × 1.5</code>; daily total &le;{" "}
                      <code>min(availHrs × 1.5, 24h)</code>
                    </td>
                    <td className="px-3 py-1">No cap</td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1 font-medium">Excluded sites</td>
                    <td className="px-3 py-1">
                      CookUnity NYC (flag in{" "}
                      <code>sites-config.ts</code>)
                    </td>
                    <td className="px-3 py-1">
                      Selectable; nothing globally excluded
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1 font-medium">Uptime</td>
                    <td className="px-3 py-1">
                      Defaults to 100%; editor-only manual adjustments with
                      required Pylon ticket
                    </td>
                    <td className="px-3 py-1">
                      Not tracked here — uses different data sources
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted text-[13px] mt-2">
              Net effect: for the same site + date range, the dashboard&apos;s
              servings total is usually <em>slightly lower</em> than
              Retool&apos;s, because we exclude failed sessions and
              non-scheduled days, and we cap sessions that look stuck. The
              difference is usually 1-5% but can be larger if a site has
              flaky reporting that produced inflated single sessions.
            </p>
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
              Per (robot, date), total servings ={" "}
              <code className="text-[12px]">SUM(bowl_count)</code> across that
              robot&apos;s PRODUCTION-labeled sessions on that date. Pulled
              from <code className="text-[12px]">sessions_v0.bowl_count</code>{" "}
              — same column Retool&apos;s Daily Production Summary uses for
              its &ldquo;Deposits&rdquo; KPI. One bowl = one serving.
            </p>
            <p className="text-muted text-[13px] mt-1">
              The bucket rollup <strong>sums</strong> across days and robots
              (totals, not averages). The KPI card shows the grand total for
              the selected date range and site filter.
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

          {/* BigQuery session labels */}
          <div>
            <h3 className="font-semibold mt-3 mb-1">
              BigQuery session labels (what counts as production)
            </h3>
            <p className="text-muted text-[13px] mb-2">
              Every row in <code className="text-[12px]">sessions_v0</code>{" "}
              has a <code className="text-[12px]">label</code> field. Only{" "}
              <code className="text-[12px]">PRODUCTION</code> counts toward
              the util numerator. Snapshot from the last 30 days:
            </p>
            <div className="overflow-x-auto">
              <table className="text-[13px] border border-line rounded-md">
                <thead className="bg-cream/40">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">Label</th>
                    <th className="text-right px-3 py-1.5 font-medium">
                      Sessions
                    </th>
                    <th className="text-right px-3 py-1.5 font-medium">
                      Total hrs
                    </th>
                    <th className="text-left px-3 py-1.5 font-medium">
                      In util?
                    </th>
                  </tr>
                </thead>
                <tbody className="text-ink">
                  <tr className="border-t border-line">
                    <td className="px-3 py-1 font-medium">PRODUCTION</td>
                    <td className="px-3 py-1 text-right tabular-nums">7,633</td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      13,707
                    </td>
                    <td className="px-3 py-1 text-emerald-700">✓ counted</td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1">SETUP</td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      10,040
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">9,735</td>
                    <td className="px-3 py-1 text-muted">
                      excluded (changeover / cleaning)
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1">TESTING</td>
                    <td className="px-3 py-1 text-right tabular-nums">1,694</td>
                    <td className="px-3 py-1 text-right tabular-nums">1,750</td>
                    <td className="px-3 py-1 text-muted">
                      excluded (engineering / QA)
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1">STARTUP</td>
                    <td className="px-3 py-1 text-right tabular-nums">5,471</td>
                    <td className="px-3 py-1 text-right tabular-nums">41</td>
                    <td className="px-3 py-1 text-muted">
                      excluded (boot log)
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-3 py-1">END_OF_DAY</td>
                    <td className="px-3 py-1 text-right tabular-nums">578</td>
                    <td className="px-3 py-1 text-right tabular-nums">5</td>
                    <td className="px-3 py-1 text-muted">
                      excluded (shutdown log)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted text-[12px] mt-2">
              Numbers are a Jun 2026 snapshot. If you ever want to change
              what counts, edit <code className="text-[12px]">lib/metrics-rollup.ts</code>{" "}
              — the filter is{" "}
              <code className="text-[12px]">
                IF(label = &apos;PRODUCTION&apos;, duration_sec, 0)
              </code>
              .
            </p>
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
  // Width scales with bucket count so each cluster has room to breathe.
  // Min 800 (so legend + labels fit on narrow viewports), grows with buckets.
  const W = Math.max(800, buckets.length * 48);
  const H = 300;
  const padL = 40;
  const padR = 16;
  const padT = 12;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Hover tooltip — HTML overlay above the SVG, follows the mouse.
  // Native <title> was unreliable (took too long to appear, easy to miss).
  const [hover, setHover] = useState<{
    site: string;
    bucket: string;
    util: number;
    hours: number;
    robots: number;
    color: string;
    x: number; // px relative to wrapper
    y: number;
  } | null>(null);

  if (buckets.length === 0 || sites.length === 0) {
    return (
      <div className="text-muted text-sm py-6 text-center">
        No data for this range.
      </div>
    );
  }

  // Group geometry: each bucket gets a column of width groupW; site bars
  // pack into 80% of that, leaving a 20% gap between buckets.
  const groupW = plotW / buckets.length;
  const usableW = groupW * 0.8;
  const barW = Math.max(2, usableW / sites.length);
  const groupCenter = (i: number) => padL + groupW * (i + 0.5);
  const yFor = (v: number) =>
    padT + plotH - (Math.min(v, yMax) / yMax) * plotH;

  // y-axis grid lines
  const yTicks = [0, 25, 50, 75, 100];
  if (yMax > 100) yTicks.push(yMax);

  return (
    <div className="w-full overflow-x-auto relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 600 }}
        onMouseLeave={() => setHover(null)}
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

        {/* X-axis baseline */}
        <line
          x1={padL}
          x2={W - padR}
          y1={yFor(0)}
          y2={yFor(0)}
          stroke="currentColor"
          strokeOpacity="0.2"
        />

        {/* X-axis labels — every Nth bucket for readability */}
        {buckets.map((b, i) => {
          const step = Math.ceil(buckets.length / 14);
          if (i % step !== 0 && i !== buckets.length - 1) return null;
          const inferredGrain: "day" | "week" | "month" = /^\d{4}-\d{2}-\d{2}$/.test(
            b
          )
            ? "day"
            : /^\d{4}-W\d+$/.test(b)
              ? "week"
              : "month";
          const f = formatBucket(b, inferredGrain);
          return (
            <g key={b}>
              <text
                x={groupCenter(i)}
                y={H - padB + 14}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                opacity="0.7"
              >
                {f.line1}
              </text>
              {f.line2 ? (
                <text
                  x={groupCenter(i)}
                  y={H - padB + 26}
                  textAnchor="middle"
                  fontSize="9"
                  fill="currentColor"
                  opacity="0.5"
                >
                  {f.line2}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Grouped bars — one column per bucket, one bar per site */}
        {buckets.map((b, i) => {
          const groupLeft = groupCenter(i) - usableW / 2;
          return (
            <g key={b}>
              {sites.map((site, si) => {
                const cell = matrix.get(site)?.get(b);
                const v =
                  cell && cell[metric] !== null && cell[metric] !== undefined
                    ? (cell[metric] as number)
                    : null;
                if (v === null) return null;
                const barH = (Math.min(v, yMax) / yMax) * plotH;
                const x = groupLeft + si * barW;
                const y = padT + plotH - barH;
                const color = SITE_COLORS[si % SITE_COLORS.length];
                const hrs = Number(cell?.hoursSum ?? 0);
                const nRobots = Number(cell?.robotsCount ?? 0);
                return (
                  <rect
                    key={site}
                    x={x}
                    y={y}
                    width={Math.max(1, barW - 0.5)}
                    height={Math.max(0.5, barH)}
                    fill={color}
                    opacity={0.9}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      const svg = (e.currentTarget as SVGRectElement)
                        .ownerSVGElement;
                      if (!svg) return;
                      const svgRect = svg.getBoundingClientRect();
                      // Position tooltip near the top of the bar, in wrapper coords.
                      const scaleX = svgRect.width / W;
                      const scaleY = svgRect.height / H;
                      setHover({
                        site,
                        bucket: b,
                        util: v,
                        hours: hrs,
                        robots: nRobots,
                        color,
                        x: (x + barW / 2) * scaleX,
                        y: y * scaleY,
                      });
                    }}
                  >
                    <title>{`${site} · ${b} · ${v.toFixed(1)}%${hrs > 0 ? ` · ${hrs.toFixed(1)}h across ${nRobots} robots` : ""}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* HTML overlay tooltip — anchored above the hovered bar */}
      {hover ? (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line bg-card shadow-lg px-3 py-2 text-xs"
          style={{
            left: hover.x,
            top: Math.max(0, hover.y - 12),
            transform: "translate(-50%, -100%)",
            whiteSpace: "nowrap",
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: hover.color }}
            />
            <span className="font-semibold text-ink">{hover.site}</span>
            <span className="text-muted">· {hover.bucket}</span>
          </div>
          <div className="tabular-nums text-ink">
            {hover.util.toFixed(1)}% util
            {hover.hours > 0 ? (
              <>
                {" · "}
                <span className="font-medium">
                  {hover.hours.toFixed(1)}h run
                </span>
                {hover.robots > 0 ? (
                  <span className="text-muted">
                    {" "}
                    across {hover.robots} robot
                    {hover.robots === 1 ? "" : "s"}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted"> · no hours reported</span>
            )}
          </div>
        </div>
      ) : null}

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
