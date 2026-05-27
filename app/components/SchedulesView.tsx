"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LINES,
  LineConfig,
  linesGroupedBySite,
} from "@/lib/schedules-config";

const STORAGE_KEY = "chef-support-schedule-overrides-v1";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Overrides = Record<
  string,
  { robot?: number; total?: number } | undefined
>;

// YYYY-MM-DD in local time.
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Mon-of-week for a given date (local).
function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay(); // 0 = Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + diff);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function shortMonthDay(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fmtNum(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  }
  return String(n);
}

export default function SchedulesView() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [overrides, setOverrides] = useState<Overrides>({});
  const [editing, setEditing] = useState<{
    lineId: string;
    date: string;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setOverrides(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      // ignore
    }
  }, [overrides]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  function cellValues(line: LineConfig, date: Date) {
    const key = `${line.id}|${fmtDate(date)}`;
    const ov = overrides[key];
    const dow = date.getDay();
    const robot =
      ov?.robot !== undefined ? ov.robot : line.defaultRobotByDow[dow];
    const total =
      ov?.total !== undefined ? ov.total : line.defaultTotalByDow[dow];
    return { robot, total, hasOverride: !!ov };
  }

  function weekTotals(line: LineConfig) {
    let robot = 0;
    let total = 0;
    for (const d of days) {
      const c = cellValues(line, d);
      if (c.robot !== null && c.robot !== undefined) robot += c.robot;
      if (c.total !== null && c.total !== undefined) total += c.total;
    }
    return { robot, total };
  }

  const isThisWeek = fmtDate(weekStart) === fmtDate(mondayOf(today));
  const weekLabel = isThisWeek ? "This week" : "Week of " + shortMonthDay(weekStart);
  const weekRange = `${shortMonthDay(weekStart)} – ${shortMonthDay(
    addDays(weekStart, 6)
  )}`;
  const grouped = linesGroupedBySite();

  function applyOverride(
    lineId: string,
    date: string,
    field: "robot" | "total",
    value: number | undefined
  ) {
    const key = `${lineId}|${date}`;
    setOverrides((prev) => {
      const cur = { ...(prev[key] ?? {}) };
      if (value === undefined) {
        delete (cur as any)[field];
      } else {
        cur[field] = value;
      }
      const isEmpty =
        cur.robot === undefined && cur.total === undefined;
      const next = { ...prev };
      if (isEmpty) delete next[key];
      else next[key] = cur;
      return next;
    });
  }

  function clearOverride(lineId: string, date: string) {
    const key = `${lineId}|${date}`;
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  return (
    <div>
      {/* Session-only banner — light amber to match design tokens */}
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3 items-start">
        <span className="text-amber-700 text-base leading-none mt-0.5">⚠</span>
        <div className="text-sm text-amber-900">
          Schedule edits persist in this browser session only. SQLite schedule
          store hasn&apos;t been wired yet — closing the tab resets any overrides.
        </div>
      </div>

      {/* Section title + week nav */}
      <div className="flex justify-between items-end mb-3 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Weekly schedule — expected deposits by line
          </h2>
          <div className="text-xs text-muted mt-1 max-w-3xl">
            Each cell shows{" "}
            <span className="text-ink font-medium">robot expected</span>{" "}
            (our commitment) over{" "}
            <span className="text-ink font-medium">total line expected</span>{" "}
            (robot + human). Click to override.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="px-2 py-1 rounded-md border border-line bg-white hover:bg-cream text-sm"
            aria-label="Previous week"
          >
            ‹
          </button>
          <button
            onClick={() => setWeekStart(mondayOf(today))}
            className={
              "px-3 py-1 rounded-md border text-sm " +
              (isThisWeek
                ? "bg-ink text-white border-ink"
                : "bg-white border-line hover:bg-cream")
            }
          >
            {weekLabel}
          </button>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="px-2 py-1 rounded-md border border-line bg-white hover:bg-cream text-sm"
            aria-label="Next week"
          >
            ›
          </button>
          <span className="text-xs text-muted ml-2">{weekRange}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-[0_1px_0_rgba(0,0,0,.02)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted bg-cream">
              <th className="text-left py-2.5 px-3 w-44 font-medium">Line</th>
              {days.map((d) => {
                const isToday = fmtDate(d) === fmtDate(today);
                return (
                  <th
                    key={fmtDate(d)}
                    className={
                      "text-center py-2.5 px-2 w-24 font-medium " +
                      (isToday ? "text-blue-700" : "")
                    }
                  >
                    <div>{DAY_NAMES[d.getDay()]}</div>
                    <div className="font-normal normal-case text-muted">
                      {shortMonthDay(d)}
                    </div>
                  </th>
                );
              })}
              <th className="text-right py-2.5 px-3 w-32 font-medium">
                Week (robot / total)
              </th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ site, lines }) => (
              <SiteRows
                key={site}
                site={site}
                lines={lines}
                days={days}
                today={today}
                cellValues={cellValues}
                weekTotals={weekTotals}
                editing={editing}
                setEditing={setEditing}
                applyOverride={applyOverride}
                clearOverride={clearOverride}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SiteRows({
  site,
  lines,
  days,
  today,
  cellValues,
  weekTotals,
  editing,
  setEditing,
  applyOverride,
  clearOverride,
}: {
  site: string;
  lines: LineConfig[];
  days: Date[];
  today: Date;
  cellValues: (line: LineConfig, d: Date) => {
    robot: number | null | undefined;
    total: number | null | undefined;
    hasOverride: boolean;
  };
  weekTotals: (line: LineConfig) => { robot: number; total: number };
  editing: { lineId: string; date: string } | null;
  setEditing: (s: { lineId: string; date: string } | null) => void;
  applyOverride: (
    lineId: string,
    date: string,
    field: "robot" | "total",
    value: number | undefined
  ) => void;
  clearOverride: (lineId: string, date: string) => void;
}) {
  return (
    <>
      <tr className="bg-cream border-t border-line">
        <td colSpan={9} className="py-2 px-3">
          <span className="font-semibold text-ink">{site}</span>
          <span className="text-xs text-muted ml-2">
            {lines.length} lines · {lines[0].operatingHours}
          </span>
        </td>
      </tr>
      {lines.map((line) => {
        const wk = weekTotals(line);
        return (
          <tr key={line.id} className="border-t border-line hover:bg-cream/60">
            <td className="py-2 px-3 text-ink">{line.lineName}</td>
            {days.map((d) => {
              const date = fmtDate(d);
              const { robot, total, hasOverride } = cellValues(line, d);
              const isToday = date === fmtDate(today);
              const isPast = d < today;
              const isEditingCell =
                editing?.lineId === line.id && editing?.date === date;
              const blank = robot == null && total == null;
              return (
                <td key={date} className="relative py-1 px-1 text-center align-middle">
                  {blank ? (
                    <div className="text-muted text-base">—</div>
                  ) : (
                    <button
                      onClick={() =>
                        setEditing(
                          isEditingCell ? null : { lineId: line.id, date }
                        )
                      }
                      className={
                        "relative inline-flex flex-col items-center justify-center w-20 py-1 rounded-md border transition-colors " +
                        (isToday
                          ? "border-blue-400 bg-blue-50 "
                          : isPast
                          ? "border-line bg-cream "
                          : "border-line bg-white ") +
                        "hover:border-zinc-400 hover:bg-cream"
                      }
                      title={
                        isPast
                          ? "Past day — click to override anyway"
                          : "Click to override"
                      }
                    >
                      {isPast ? (
                        <span className="absolute top-1 left-1.5 text-[10px] text-muted">
                          🔒
                        </span>
                      ) : null}
                      <span className="text-sm leading-tight font-medium text-ink">
                        {robot != null ? fmtNum(robot) : "—"}
                      </span>
                      <span className="text-[10px] text-muted leading-tight">
                        / {total != null ? fmtNum(total) : "—"}
                      </span>
                      {hasOverride ? (
                        <span className="absolute -top-1 -right-1 inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
                      ) : null}
                    </button>
                  )}
                  {isEditingCell ? (
                    <CellEditor
                      line={line}
                      date={date}
                      robot={robot ?? null}
                      total={total ?? null}
                      onClose={() => setEditing(null)}
                      onApply={(field, value) =>
                        applyOverride(line.id, date, field, value)
                      }
                      onClear={() => {
                        clearOverride(line.id, date);
                        setEditing(null);
                      }}
                      hasOverride={hasOverride}
                    />
                  ) : null}
                </td>
              );
            })}
            <td className="py-2 px-3 text-right">
              <div className="text-sm text-ink">{wk.robot.toLocaleString()}</div>
              <div className="text-[10px] text-muted">
                / {wk.total.toLocaleString()}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function CellEditor({
  line,
  date,
  robot,
  total,
  onApply,
  onClear,
  onClose,
  hasOverride,
}: {
  line: LineConfig;
  date: string;
  robot: number | null;
  total: number | null;
  onApply: (field: "robot" | "total", value: number | undefined) => void;
  onClear: () => void;
  onClose: () => void;
  hasOverride: boolean;
}) {
  const [r, setR] = useState<string>(robot != null ? String(robot) : "");
  const [t, setT] = useState<string>(total != null ? String(total) : "");

  function save() {
    const rn = r === "" ? undefined : Number(r);
    const tn = t === "" ? undefined : Number(t);
    if (rn === undefined || Number.isFinite(rn)) onApply("robot", rn);
    if (tn === undefined || Number.isFinite(tn)) onApply("total", tn);
    onClose();
  }

  return (
    <div
      className="absolute z-50 left-1/2 top-full mt-2 -translate-x-1/2 bg-white border border-line rounded-lg shadow-lg p-3 text-left w-64"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="text-xs text-muted mb-2">
        <span className="text-ink font-medium">{line.lineName}</span> · {date}
      </div>
      <label className="block text-xs text-muted mb-1">Robot expected</label>
      <input
        type="number"
        value={r}
        onChange={(e) => setR(e.target.value)}
        className="w-full bg-white border border-line rounded-md px-2 py-1 text-sm mb-2 focus:outline-none focus:border-zinc-400"
        placeholder="(default)"
      />
      <label className="block text-xs text-muted mb-1">
        Total line expected
      </label>
      <input
        type="number"
        value={t}
        onChange={(e) => setT(e.target.value)}
        className="w-full bg-white border border-line rounded-md px-2 py-1 text-sm mb-3 focus:outline-none focus:border-zinc-400"
        placeholder="(default)"
      />
      <div className="flex justify-between items-center">
        <button
          onClick={onClear}
          disabled={!hasOverride}
          className="text-xs text-amber-700 hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Reset to default
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded-md border border-line bg-white hover:bg-cream"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="text-xs px-3 py-1 rounded-md bg-ink text-white font-medium hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
