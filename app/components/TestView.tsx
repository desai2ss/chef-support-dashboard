"use client";

// Test tab — one site, daily grain. Utilization comes from /api/metrics
// (same numbers as the Metrics tab); pstops come from /api/pstops, both
// backed by the nightly BigQuery rollup.

import { useEffect, useMemo, useState } from "react";
import { SITES } from "@/lib/sites-config";
import {
  KpiCard,
  LineChart,
  formatBucket,
  type RollupRow,
} from "./MetricsView";

type PstopsResponse = {
  ok?: boolean;
  totalPstops: number;
  sessions: number;
  perDay: { date: string; pstops: number; sessions: number }[];
  topModules: { sn: number; nickname: string; spare: boolean; pstops: number }[];
  topIngredients: { ingredient: string; pstops: number }[];
  error?: string;
};

const METRIC_SITES = SITES.filter((s) => !s.excludeFromMetrics).map((s) => s.name);

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

export default function TestView() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [from, setFrom] = useState<string>(fmtDate(addDays(today, -7)));
  const [to, setTo] = useState<string>(fmtDate(today));
  const [site, setSite] = useState<string>(METRIC_SITES[0] ?? "");

  const [utilRows, setUtilRows] = useState<RollupRow[]>([]);
  const [pstops, setPstops] = useState<PstopsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!site || from > to) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from, to, site });
    const metricsQs = new URLSearchParams({ from, to, site, grain: "day" });
    Promise.all([
      fetch(`/api/metrics?${metricsQs.toString()}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/pstops?${qs.toString()}`, { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([m, p]) => {
        if (!alive) return;
        if (!m.ok) throw new Error(m.error ?? "Metrics request failed");
        if (!p.ok) throw new Error(p.error ?? "Pstops request failed");
        setUtilRows(m.rows ?? []);
        setPstops(p);
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e?.message ?? e));
        setUtilRows([]);
        setPstops(null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [from, to, site]);

  // Same calculation as the Metrics tab's "Fleet utilization" card:
  // average of the daily site values, skipping unscheduled days.
  const fleetUtil = useMemo(() => {
    let sum = 0;
    let n = 0;
    for (const r of utilRows) {
      if (r.utilPctAvg === null || r.utilPctAvg === undefined) continue;
      const u = Number(r.utilPctAvg);
      if (Number.isFinite(u)) {
        sum += u;
        n += 1;
      }
    }
    return n > 0 ? sum / n : null;
  }, [utilRows]);

  const buckets = useMemo(
    () => Array.from(new Set(utilRows.map((r) => r.bucket))).sort(),
    [utilRows]
  );
  const matrix = useMemo(() => {
    const m = new Map<string, Map<string, RollupRow>>();
    for (const r of utilRows) {
      if (!m.has(r.site)) m.set(r.site, new Map());
      m.get(r.site)!.set(r.bucket, r);
    }
    return m;
  }, [utilRows]);

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
              Site
            </label>
            <select
              value={site}
              onChange={(e) => setSite(e.target.value)}
              className="bg-card border border-line rounded-md px-2 py-1 text-sm focus:outline-none focus:border-zinc-400"
            >
              {METRIC_SITES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Status / errors */}
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      ) : null}
      {loading ? <div className="mb-4 text-muted text-sm">Loading…</div> : null}
      {!loading && !error && pstops && pstops.sessions === 0 ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No pstop data for this range yet. Data updates nightly; for older
          dates, run the backfill:{" "}
          <code>/api/metrics/backfill?from={from}&amp;to={to}</code> (editor
          only).
        </div>
      ) : null}

      {/* KPI cards */}
      <section className="grid grid-cols-2 gap-4 mb-5">
        <KpiCard
          label="Fleet utilization"
          value={fleetUtil !== null ? fleetUtil.toFixed(1) + "%" : "—"}
          sub="avg across scheduled days"
        />
        <KpiCard
          label="Total pstops"
          value={pstops ? pstops.totalPstops.toLocaleString() : "—"}
          sub={
            pstops
              ? `${pstops.sessions.toLocaleString()} completed production sessions`
              : "completed production sessions"
          }
        />
      </section>

      {/* Utilization chart — same component as the Metrics tab */}
      <section className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="text-base font-semibold">Utilization % over time</h2>
          <span className="text-xs text-muted">
            {site} · {from} – {to}
          </span>
        </div>
        <LineChart
          buckets={buckets}
          matrix={matrix}
          sites={site ? [site] : []}
          metric="utilPctAvg"
          yMax={150}
        />
      </section>

      {/* Pstops per day — same day columns as the utilization chart */}
      <section className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="text-base font-semibold">Pstops per day</h2>
          <span className="text-xs text-muted">by session start date</span>
        </div>
        <PstopBarChart buckets={buckets} perDay={pstops?.perDay ?? []} />
      </section>

      {/* Top lists */}
      <section className="grid grid-cols-2 gap-4">
        <TopList
          title="Top modules by pstops"
          rows={(pstops?.topModules ?? []).map((m) => ({
            key: String(m.sn),
            label: `SN${m.sn} ${m.nickname}${m.spare ? " · spare" : ""}`,
            value: m.pstops,
          }))}
        />
        <TopList
          title="Top ingredients by pstops"
          rows={(pstops?.topIngredients ?? []).map((i) => ({
            key: i.ingredient,
            label: i.ingredient,
            value: i.pstops,
          }))}
        />
      </section>
    </div>
  );
}

// ---- Pstops per day (inline SVG, geometry matches LineChart) ------------
function PstopBarChart({
  buckets,
  perDay,
}: {
  buckets: string[];
  perDay: { date: string; pstops: number }[];
}) {
  const [hover, setHover] = useState<{
    date: string;
    pstops: number;
    x: number;
    y: number;
  } | null>(null);

  if (buckets.length === 0) {
    return (
      <div className="text-muted text-sm py-6 text-center">
        No data for this range.
      </div>
    );
  }

  const byDate = new Map(perDay.map((d) => [d.date, d.pstops]));
  const maxV = Math.max(1, ...buckets.map((b) => byDate.get(b) ?? 0));
  // Round the axis up to a "nice" number.
  const mag = Math.pow(10, Math.floor(Math.log10(maxV)));
  const yMax = Math.ceil(maxV / mag) * mag;
  const yTicks = [0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax];

  const W = Math.max(800, buckets.length * 48);
  const H = 220;
  const padL = 40;
  const padR = 16;
  const padT = 12;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const groupW = plotW / buckets.length;
  const barW = Math.max(2, groupW * 0.8);
  const groupCenter = (i: number) => padL + groupW * (i + 0.5);
  const yFor = (v: number) => padT + plotH - (v / yMax) * plotH;

  return (
    <div className="w-full overflow-x-auto relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 600 }}
        onMouseLeave={() => setHover(null)}
      >
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
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        <line
          x1={padL}
          x2={W - padR}
          y1={yFor(0)}
          y2={yFor(0)}
          stroke="currentColor"
          strokeOpacity="0.2"
        />
        {buckets.map((b, i) => {
          const step = Math.ceil(buckets.length / 14);
          if (i % step !== 0 && i !== buckets.length - 1) return null;
          const f = formatBucket(b, "day");
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
            </g>
          );
        })}
        {buckets.map((b, i) => {
          const v = byDate.get(b) ?? 0;
          if (v === 0) return null;
          const x = groupCenter(i) - barW / 2;
          const y = yFor(v);
          return (
            <rect
              key={b}
              x={x}
              y={y}
              width={barW}
              height={Math.max(0.5, yFor(0) - y)}
              fill="#dc2626"
              opacity={0.85}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => {
                const svg = (e.currentTarget as SVGRectElement).ownerSVGElement;
                if (!svg) return;
                const rect = svg.getBoundingClientRect();
                setHover({
                  date: b,
                  pstops: v,
                  x: groupCenter(i) * (rect.width / W),
                  y: y * (rect.height / H),
                });
              }}
            >
              <title>{`${b} · ${v} pstops`}</title>
            </rect>
          );
        })}
      </svg>
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
          <span className="text-muted">{hover.date} · </span>
          <span className="font-semibold text-ink tabular-nums">
            {hover.pstops} pstop{hover.pstops === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---- Top-N list with competition ranks (ties share a rank) --------------
function TopList({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; value: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <h2 className="text-base font-semibold mb-3">{title}</h2>
      {rows.length === 0 ? (
        <div className="text-muted text-sm">No pstops in this range.</div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => {
              const rank =
                i > 0 && rows[i - 1].value === r.value
                  ? rows.findIndex((x) => x.value === r.value) + 1
                  : i + 1;
              return (
                <tr key={r.key} className="border-t border-line first:border-t-0">
                  <td className="py-1.5 pr-2 text-muted tabular-nums w-6">{rank}</td>
                  <td className="py-1.5 pr-2 text-ink">{r.label}</td>
                  <td className="py-1.5 pr-2 w-1/3">
                    <div
                      className="h-2 rounded-sm bg-red-600 opacity-80"
                      style={{ width: `${(r.value / max) * 100}%` }}
                    />
                  </td>
                  <td className="py-1.5 text-right tabular-nums font-medium w-12">
                    {r.value.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
