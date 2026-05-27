"use client";

import { useEffect, useMemo, useState } from "react";
import { TEAM, TeamMember } from "@/lib/team-config";

type Bandwidth = {
  id: string;
  name: string;
  initials: string;
  colorClass: string;
  pylonEmail: string | null;
  pylonIdPending: boolean;
  count: number;
  tickets: {
    number: number | null;
    title: string;
    site: string;
    state: string;
    link: string | null;
    latest: string | null;
  }[];
};

type ApiResponse = {
  configured: boolean;
  members?: Bandwidth[];
  error?: string;
  message?: string;
};

const WORKING_KEY = "chef-support-team-working-v1";
const CALENDAR_KEY = "chef-support-team-calendar-v1";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type WorkingOn = Record<string, { task: string; status?: string; updated?: string }>;
type Calendar = Record<string, string>; // key = "<memberId>|YYYY-MM-DD" -> note

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay();
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
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TeamView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [working, setWorking] = useState<WorkingOn>({});
  const [calendar, setCalendar] = useState<Calendar>({});

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const weekStart = useMemo(() => mondayOf(today), [today]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Load Pylon-backed bandwidth
  useEffect(() => {
    let alive = true;
    fetch("/api/team", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setData(j))
      .catch((e) =>
        alive && setData({ configured: true, error: String(e), members: [] })
      );
    return () => {
      alive = false;
    };
  }, []);

  // Load + persist working
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKING_KEY);
      if (raw) setWorking(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(WORKING_KEY, JSON.stringify(working));
    } catch {}
  }, [working]);

  // Load + persist calendar
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CALENDAR_KEY);
      if (raw) setCalendar(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_KEY, JSON.stringify(calendar));
    } catch {}
  }, [calendar]);

  const members = data?.members ?? TEAM.map(toFallback);
  const maxCount = Math.max(1, ...members.map((m) => m.count));

  return (
    <div>
      {/* Bandwidth section */}
      <section className="mb-6 rounded-xl border border-line bg-white shadow-[0_1px_0_rgba(0,0,0,.02)] p-5">
        <div className="flex justify-between items-baseline mb-4">
          <h2 className="text-base font-semibold">Team bandwidth</h2>
          <span className="text-xs text-muted">
            Open Pylon tickets assigned to each person
          </span>
        </div>

        {data && !data.configured ? (
          <div className="text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm mb-3">
            {data.message ?? "PYLON_API_KEY not set."}
          </div>
        ) : null}
        {data?.error ? (
          <div className="text-red-700 bg-red-50 border border-red-200 rounded-md p-3 text-sm mb-3">
            {data.error}
          </div>
        ) : null}
        {!data ? (
          <div className="text-muted text-sm">Loading bandwidth…</div>
        ) : (
          <div className="flex flex-col gap-3">
            {members.map((m) => (
              <BandwidthRow key={m.id} m={m} maxCount={maxCount} />
            ))}
            {members.some((m) => m.pylonIdPending) ? (
              <div className="text-xs text-muted mt-1">
                {members
                  .filter((m) => m.pylonIdPending)
                  .map((m) => `${m.name}'s Pylon user ID pending`)
                  .join(", ")}{" "}
                — bandwidth will populate once assigned.
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* Manual data banner */}
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3 items-start">
        <span className="text-amber-700 text-base leading-none mt-0.5">⚠</span>
        <div className="text-sm text-amber-900">
          Working-on and calendar edits below persist in this browser session
          only. SQLite store isn&apos;t wired yet — closing the tab resets them.
        </div>
      </div>

      {/* Currently working on */}
      <section className="mb-6 rounded-xl border border-line bg-white shadow-[0_1px_0_rgba(0,0,0,.02)] p-5">
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="text-base font-semibold">Currently working on</h2>
          <span className="text-xs text-muted">Click a cell to edit</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left py-2 px-2 w-44 font-medium">Person</th>
                <th className="text-left py-2 px-2 font-medium">Currently working on</th>
                <th className="text-left py-2 px-2 w-32 font-medium">Status</th>
                <th className="text-left py-2 px-2 w-32 font-medium">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {TEAM.map((m) => (
                <WorkingRow
                  key={m.id}
                  m={m}
                  value={working[m.id]}
                  onChange={(v) =>
                    setWorking((prev) => ({
                      ...prev,
                      [m.id]: { ...v, updated: new Date().toISOString() },
                    }))
                  }
                  onClear={() =>
                    setWorking((prev) => {
                      const n = { ...prev };
                      delete n[m.id];
                      return n;
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Team calendar — manual entry per person per day */}
      <section className="rounded-xl border border-line bg-white shadow-[0_1px_0_rgba(0,0,0,.02)] p-5">
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="text-base font-semibold">Team calendar — this week</h2>
          <span className="text-xs text-muted">
            {shortMonthDay(days[0])} – {shortMonthDay(days[6])} · click cell to edit
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left py-2 px-2 w-44 font-medium">Person</th>
                {days.map((d) => {
                  const isToday = fmtDate(d) === fmtDate(today);
                  return (
                    <th
                      key={fmtDate(d)}
                      className={
                        "text-left py-2 px-2 font-medium " +
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
              </tr>
            </thead>
            <tbody>
              {TEAM.map((m) => (
                <CalendarRow
                  key={m.id}
                  m={m}
                  days={days}
                  today={today}
                  calendar={calendar}
                  onSet={(date, note) =>
                    setCalendar((prev) => {
                      const key = `${m.id}|${date}`;
                      const next = { ...prev };
                      if (!note.trim()) delete next[key];
                      else next[key] = note.trim();
                      return next;
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function toFallback(m: TeamMember): Bandwidth {
  return {
    id: m.id,
    name: m.name,
    initials: m.initials,
    colorClass: m.colorClass,
    pylonEmail: m.pylonEmail,
    pylonIdPending: !m.pylonEmail,
    count: 0,
    tickets: [],
  };
}

function BandwidthRow({
  m,
  maxCount,
}: {
  m: Bandwidth;
  maxCount: number;
}) {
  const widthPct = m.count === 0 ? 4 : Math.max(8, (m.count / maxCount) * 100);
  return (
    <div className="flex items-center gap-3">
      <div
        className={
          "shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold " +
          m.colorClass
        }
      >
        {m.initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink">{m.name}</div>
      </div>
      <div className="flex-1 max-w-md">
        <div className="h-2 bg-cream rounded-full overflow-hidden">
          <div
            className={"h-full " + m.colorClass}
            style={{ width: `${widthPct}%`, opacity: m.count === 0 ? 0.25 : 1 }}
          />
        </div>
      </div>
      <div className="w-10 text-right text-sm font-medium text-ink">{m.count}</div>
    </div>
  );
}

function WorkingRow({
  m,
  value,
  onChange,
  onClear,
}: {
  m: TeamMember;
  value?: { task: string; status?: string; updated?: string };
  onChange: (v: { task: string; status?: string }) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTask, setDraftTask] = useState(value?.task ?? "");
  const [draftStatus, setDraftStatus] = useState(value?.status ?? "");

  function save() {
    if (!draftTask.trim() && !draftStatus.trim()) {
      onClear();
    } else {
      onChange({ task: draftTask, status: draftStatus });
    }
    setEditing(false);
  }
  function cancel() {
    setDraftTask(value?.task ?? "");
    setDraftStatus(value?.status ?? "");
    setEditing(false);
  }

  const ago = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  };

  return (
    <tr className="border-t border-line">
      <td className="py-2 px-2">
        <div className="flex items-center gap-2">
          <div
            className={
              "shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold " +
              m.colorClass
            }
          >
            {m.initials}
          </div>
          <span className="text-sm text-ink">{m.name}</span>
        </div>
      </td>
      {editing ? (
        <>
          <td className="py-2 px-2" colSpan={2}>
            <div className="flex gap-2">
              <input
                value={draftTask}
                onChange={(e) => setDraftTask(e.target.value)}
                placeholder="What are they working on?"
                className="flex-1 bg-white border border-line rounded-md px-2 py-1 text-sm focus:outline-none focus:border-zinc-400"
                autoFocus
              />
              <input
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value)}
                placeholder="Status (optional)"
                className="w-40 bg-white border border-line rounded-md px-2 py-1 text-sm focus:outline-none focus:border-zinc-400"
              />
            </div>
          </td>
          <td className="py-2 px-2">
            <div className="flex gap-1 justify-end">
              <button
                onClick={cancel}
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
          </td>
        </>
      ) : (
        <>
          <td
            className="py-2 px-2 text-sm cursor-pointer hover:bg-cream/60"
            onClick={() => setEditing(true)}
          >
            {value?.task ? (
              <span className="text-ink">{value.task}</span>
            ) : (
              <span className="text-muted italic">Click to add…</span>
            )}
          </td>
          <td
            className="py-2 px-2 text-sm cursor-pointer hover:bg-cream/60"
            onClick={() => setEditing(true)}
          >
            {value?.status ? (
              <span className="text-ink">{value.status}</span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </td>
          <td className="py-2 px-2 text-xs text-muted">{ago(value?.updated)}</td>
        </>
      )}
    </tr>
  );
}

function CalendarRow({
  m,
  days,
  today,
  calendar,
  onSet,
}: {
  m: TeamMember;
  days: Date[];
  today: Date;
  calendar: Calendar;
  onSet: (date: string, note: string) => void;
}) {
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function openEdit(date: string) {
    setDraft(calendar[`${m.id}|${date}`] ?? "");
    setEditingDate(date);
  }
  function commit() {
    if (editingDate) onSet(editingDate, draft);
    setEditingDate(null);
  }

  return (
    <tr className="border-t border-line">
      <td className="py-2 px-2">
        <div className="flex items-center gap-2">
          <div
            className={
              "shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold " +
              m.colorClass
            }
          >
            {m.initials}
          </div>
          <span className="text-sm text-ink">{m.name}</span>
        </div>
      </td>
      {days.map((d) => {
        const date = fmtDate(d);
        const key = `${m.id}|${date}`;
        const note = calendar[key];
        const isToday = date === fmtDate(today);
        const isEditing = editingDate === date;
        if (isEditing) {
          return (
            <td key={date} className="py-1 px-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditingDate(null);
                }}
                autoFocus
                className="w-full bg-white border border-blue-400 rounded-md px-1.5 py-1 text-xs focus:outline-none"
                placeholder="PTO, on-call, site visit…"
              />
            </td>
          );
        }
        return (
          <td
            key={date}
            className={
              "py-1 px-1 align-top cursor-pointer hover:bg-cream/60 " +
              (isToday ? "bg-blue-50/40" : "")
            }
            onClick={() => openEdit(date)}
          >
            <div className="min-h-[2rem] text-xs px-1.5 py-1 rounded-md border border-transparent hover:border-line">
              {note ? (
                <span className="text-ink">{note}</span>
              ) : (
                <span className="text-muted/60">—</span>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}
