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

type JiraMember = {
  id: string;
  name: string;
  initials: string;
  colorClass: string;
  count: number;
  tickets: {
    key: string;
    summary: string;
    statusName: string;
    url: string;
    updated: string | null;
  }[];
  jiraMatchPending: boolean;
};

type JiraApiResponse = {
  configured: boolean;
  projectKey?: string | null;
  members?: JiraMember[];
  error?: string;
  message?: string;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

export default function TeamView({ editor = false }: { editor?: boolean }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [jiraData, setJiraData] = useState<JiraApiResponse | null>(null);
  const [calendar, setCalendar] = useState<Calendar>({});
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  // Calendar shows a rolling window: 3 weeks back + current week + 4 weeks
  // forward = 8 weeks total. Each week renders as its own table.
  const WEEKS_BACK = 3;
  const WEEKS_FORWARD = 4;
  const weeks = useMemo(() => {
    const startMonday = addDays(mondayOf(today), -WEEKS_BACK * 7);
    return Array.from({ length: WEEKS_BACK + 1 + WEEKS_FORWARD }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => addDays(startMonday, w * 7 + d))
    );
  }, [today]);
  const days = useMemo(() => weeks.flat(), [weeks]);

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

  // Load Jira-backed bandwidth (separate endpoint so a Jira outage doesn't
  // block the Pylon section, and so the Pylon section can keep its existing
  // cache behavior).
  useEffect(() => {
    let alive = true;
    fetch("/api/jira/team", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setJiraData(j))
      .catch((e) =>
        alive &&
        setJiraData({ configured: true, error: String(e), members: [] })
      );
    return () => {
      alive = false;
    };
  }, []);

  // Load calendar from server. Persists for everyone via Postgres
  // (replaces the old localStorage-only approach).
  useEffect(() => {
    let alive = true;
    if (days.length === 0) return;
    const from = fmtDate(days[0]);
    const to = fmtDate(days[days.length - 1]);
    fetch(`/api/team-calendar?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.error) {
          setCalendarError(j.error);
          setCalendarLoaded(true);
          return;
        }
        const next: Calendar = {};
        for (const row of j.entries ?? []) {
          next[`${row.memberId}|${row.date}`] = row.note ?? "";
        }
        setCalendar(next);
        setCalendarLoaded(true);
      })
      .catch((e) => {
        if (!alive) return;
        setCalendarError(String(e));
        setCalendarLoaded(true);
      });
    return () => {
      alive = false;
    };
    // We deliberately depend only on the first/last day strings so this
    // only re-runs if the visible window shifts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmtDate(days[0] ?? new Date()), fmtDate(days[days.length - 1] ?? new Date())]);

  // Persist a single (memberId, date) → note edit to the server, with
  // optimistic local update + revert on failure.
  async function saveCalendarNote(memberId: string, date: string, note: string) {
    const key = `${memberId}|${date}`;
    const previous = calendar[key] ?? "";
    setCalendar((prev) => {
      const next = { ...prev };
      if (!note.trim()) delete next[key];
      else next[key] = note.trim();
      return next;
    });
    try {
      const r = await fetch("/api/team-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, date, note }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `Save failed (HTTP ${r.status})`);
      }
    } catch (e: any) {
      // Revert the optimistic update on failure.
      setCalendar((prev) => {
        const next = { ...prev };
        if (!previous) delete next[key];
        else next[key] = previous;
        return next;
      });
      setCalendarError(e?.message ?? "Save failed");
      // Clear the error after a few seconds so it doesn't stick around.
      setTimeout(() => setCalendarError(null), 4000);
    }
  }

  const members = data?.members ?? TEAM.map(toFallback);
  const maxCount = Math.max(1, ...members.map((m) => m.count));

  const jiraMembers = jiraData?.members ?? TEAM.map(toJiraFallback);
  const jiraMaxCount = Math.max(1, ...jiraMembers.map((m) => m.count));
  const jiraProjectKey = jiraData?.projectKey ?? "Jira";

  return (
    <div>
      {/* Bandwidth section */}
      <section className="mb-6 rounded-xl border border-line bg-card shadow-[0_1px_0_rgba(0,0,0,.02)] p-5">
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

      {/* Jira bandwidth — open tickets assigned per teammate */}
      <section className="mb-6 rounded-xl border border-line bg-card shadow-[0_1px_0_rgba(0,0,0,.02)] p-5">
        <div className="flex justify-between items-baseline mb-4">
          <h2 className="text-base font-semibold">
            Jira{" "}
            <span className="text-muted font-normal">
              {jiraData?.projectKey ? jiraData.projectKey : ""}
            </span>{" "}
            — open tickets
          </h2>
          <span className="text-xs text-muted">
            Open Jira tickets assigned to each person (
            {jiraProjectKey} board, not Done)
          </span>
        </div>

        {jiraData && !jiraData.configured ? (
          <div className="text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm mb-3">
            {jiraData.message ?? "Jira not configured."}
          </div>
        ) : null}
        {jiraData?.error ? (
          <div className="text-red-700 bg-red-50 border border-red-200 rounded-md p-3 text-sm mb-3">
            {jiraData.error}
          </div>
        ) : null}
        {!jiraData ? (
          <div className="text-muted text-sm">Loading Jira bandwidth…</div>
        ) : (
          <div className="flex flex-col gap-3">
            {jiraMembers.map((m) => (
              <JiraBandwidthRow
                key={m.id}
                m={m}
                maxCount={jiraMaxCount}
              />
            ))}
            {jiraMembers.every((m) => m.count === 0) &&
            jiraData?.configured &&
            !jiraData?.error ? (
              <div className="text-xs text-muted mt-1">
                No matches yet — Jira often hides assignee emails, so we fall
                back to display-name. If counts stay at 0, check{" "}
                <code className="text-[11px]">/api/jira/team</code> in a tab to
                see the actual <code>uniqueAssignees</code> list and adjust{" "}
                <code>lib/team-config.ts</code> names to match.
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* Team calendar — 8 stacked weeks (3 back + current + 4 forward).
          Notes persist in Postgres so everyone signed in sees the same data. */}
      <section className="rounded-xl border border-line bg-card shadow-[0_1px_0_rgba(0,0,0,.02)] p-5">
        <div className="flex justify-between items-end mb-3 flex-wrap gap-3">
          <div>
            <h2 className="text-base font-semibold">Team calendar</h2>
            <div className="text-xs text-muted mt-0.5">
              Shared across everyone signed in. Showing {WEEKS_BACK} weeks
              back and {WEEKS_FORWARD} weeks forward.{" "}
              {editor
                ? "Click any cell to add PTO, on-call, site visits, etc."
                : "Read-only — only editors can change cells."}
            </div>
          </div>
          <span className="text-xs text-muted">
            {shortMonthDay(days[0])} – {shortMonthDay(days[days.length - 1])}
          </span>
        </div>

        {calendarError ? (
          <div className="text-red-700 bg-red-50 border border-red-200 rounded-md p-3 text-sm mb-3">
            {calendarError}
          </div>
        ) : null}
        {!calendarLoaded ? (
          <div className="text-muted text-sm">Loading calendar…</div>
        ) : null}

        <div className="flex flex-col gap-5">
          {weeks.map((weekDays, wi) => {
            const isCurrentWeek =
              fmtDate(weekDays[0]) === fmtDate(mondayOf(today));
            return (
              <div key={fmtDate(weekDays[0])}>
                <div
                  className={
                    "text-xs uppercase tracking-wider mb-1.5 " +
                    (isCurrentWeek
                      ? "text-blue-700 font-semibold"
                      : "text-muted")
                  }
                >
                  {isCurrentWeek ? "This week · " : ""}Week of{" "}
                  {shortMonthDay(weekDays[0])} – {shortMonthDay(weekDays[6])}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-muted">
                        <th className="text-left py-2 px-2 w-44 font-medium">
                          Person
                        </th>
                        {weekDays.map((d) => {
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
                          key={`${m.id}-${wi}`}
                          m={m}
                          days={weekDays}
                          today={today}
                          calendar={calendar}
                          editor={editor}
                          onSet={(date, note) =>
                            saveCalendarNote(m.id, date, note)
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
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

function toJiraFallback(m: TeamMember): JiraMember {
  return {
    id: m.id,
    name: m.name,
    initials: m.initials,
    colorClass: m.colorClass,
    count: 0,
    tickets: [],
    jiraMatchPending: true,
  };
}

function JiraBandwidthRow({
  m,
  maxCount,
}: {
  m: JiraMember;
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
      <div className="w-10 text-right text-sm font-medium text-ink">
        {m.count}
      </div>
    </div>
  );
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


function CalendarRow({
  m,
  days,
  today,
  calendar,
  editor,
  onSet,
}: {
  m: TeamMember;
  days: Date[];
  today: Date;
  calendar: Calendar;
  editor: boolean;
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
                className="w-full bg-card border border-blue-400 rounded-md px-1.5 py-1 text-xs focus:outline-none"
                placeholder="PTO, on-call, site visit…"
              />
            </td>
          );
        }
        return (
          <td
            key={date}
            className={
              "py-1 px-1 align-top " +
              (editor ? "cursor-pointer hover:bg-cream/60 " : "") +
              (isToday ? "bg-blue-50/40" : "")
            }
            onClick={() => {
              if (editor) openEdit(date);
            }}
            title={editor ? "Click to edit" : "Read-only — only editors can change cells"}
          >
            <div
              className={
                "min-h-[2rem] text-xs px-1.5 py-1 rounded-md border border-transparent " +
                (editor ? "hover:border-line" : "")
              }
            >
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
