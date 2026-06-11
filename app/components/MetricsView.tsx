"use client";

// Metrics tab — Util %, Uptime %, Total Servings over a selected date range.
// Phase 1: read-only. Backed by /api/metrics (rollup) and seeded by the
// admin endpoint /api/metrics/backfill.

import { useEffect, useMemo, useState } from "react";
import { SITES } from "@/lib/sites-config";
import { ROBOTS } from "@/lib/fleet-config";

type RollupRow = {
  bucket: string; // YYYY-MM-DD | YYYY-Wxx | YYYY-MM
  site: string;
  utilPctAvg: number | null;
  uptimePctAvg: number | null;
  servingsSum: number | null;
  robotsCount: number;
};

type DailyRow = {
  sn: number;
  date: string;
  site: string;
  utilPct: number | null;
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

      {/* Per-robot daily uptime editor — only when grain=day AND site is selected */}
      {grain === "day" && siteFilter ? (
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

  // Visual style for a cell
  function cellStyle(row: DailyRow | undefined): string {
    if (!row) return "bg-cream/30 text-muted/40";
    const u = row.uptimePct ?? 100;
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
              {dates.map((d) => (
                <th
                  key={d}
                  className="text-center py-2 px-1 font-medium tabular-nums"
                  title={d}
                >
                  {d.slice(5)}
                </th>
              ))}
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
                  const u = row?.uptimePct ?? 100;
                  const hasDowntime = u < 100;
                  return (
                    <td
                      key={d}
                      onClick={(e) => handleCellClick(r.sn, d, e)}
                      className={
                        "py-1 px-1 text-center align-middle border-l border-line/40 select-none " +
                        (editor ? "cursor-pointer hover:brightness-95 " : "") +
                        cellStyle(row) +
                        " " +
                        (isSelected
                          ? "ring-2 ring-inset ring-blue-500 z-10 relative"
                          : "")
                      }
                      title={
                        row
                          ? [
                              row.utilPct != null
                                ? `util ${row.utilPct.toFixed(0)}%`
                                : "no util data",
                              `uptime ${u.toFixed(0)}%`,
                              row.uptimePylonTicket
                                ? `ticket #${row.uptimePylonTicket}`
                                : null,
                              row.uptimeNote ? `note: ${row.uptimeNote}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "no data"
                      }
                    >
                      <div className="tabular-nums text-[11px]">
                        {u.toFixed(0)}
                      </div>
                      {hasDowntime && row?.uptimePylonTicket ? (
                        <div className="text-[9px] text-muted leading-tight">
                          #{row.uptimePylonTicket}
                        </div>
                      ) : null}
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
        full uptime ·{" "}
        <span className="px-1 bg-amber-50 text-amber-900">75-99</span> partial ·{" "}
        <span className="px-1 bg-red-50 text-red-900">&lt; 75</span> major
        downtime · <span className="text-muted/60">grey</span> = no BQ data
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
