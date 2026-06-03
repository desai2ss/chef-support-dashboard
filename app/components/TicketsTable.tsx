"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  id: string;
  number: number | null;
  title: string;
  site: string;
  module: string | null;
  assignee: string | null;
  state: string;
  link: string | null;
  latest: string | null;
  tags: string[];
};

type ApiResponse = {
  configured: boolean;
  total?: number;
  rows?: Row[];
  error?: string;
  message?: string;
};

type FilterKey = "all" | "escalated" | "breached" | "untagged";

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

function tagMatch(tags: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  return tags.some((t) => t.toLowerCase().includes(n));
}

export default function TicketsTable({ editor = false }: { editor?: boolean }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  // Update one ticket's state in local data after a successful API write.
  // If the new state is "closed", remove the ticket from the list (since the
  // open-tickets feed wouldn't include it anymore).
  function applyLocalState(ticketId: string, newState: string) {
    setData((prev) => {
      if (!prev || !prev.rows) return prev;
      const next: ApiResponse = { ...prev };
      next.rows = prev.rows
        .map((r) => (r.id === ticketId ? { ...r, state: newState } : r))
        .filter((r) => r.state !== "closed");
      if (typeof prev.total === "number") next.total = next.rows.length;
      return next;
    });
  }

  useEffect(() => {
    let alive = true;
    fetch("/api/tickets", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive) setData(j);
      })
      .catch((e) => alive && setData({ configured: true, error: String(e), rows: [] }));
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    switch (filter) {
      case "escalated":
        return rows.filter((r) => tagMatch(r.tags, "escalated") || tagMatch(r.tags, "engineering"));
      case "breached":
        return rows.filter((r) => tagMatch(r.tags, "breached") || tagMatch(r.tags, "sla"));
      case "untagged":
        return rows.filter((r) => !r.module);
      default:
        return rows;
    }
  }, [data, filter]);

  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      all: rows.length,
      escalated: rows.filter((r) => tagMatch(r.tags, "escalated") || tagMatch(r.tags, "engineering")).length,
      breached: rows.filter((r) => tagMatch(r.tags, "breached") || tagMatch(r.tags, "sla")).length,
      untagged: rows.filter((r) => !r.module).length,
    };
  }, [data]);

  if (!data) {
    return <div className="text-muted text-sm">Loading tickets…</div>;
  }
  if (!data.configured) {
    return (
      <div className="text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 rounded p-3 text-sm">
        {data.message ?? "PYLON_API_KEY not set."}
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

  const chips: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "escalated", label: "Escalated to Eng", count: counts.escalated },
    { key: "breached", label: "Breached SLA", count: counts.breached },
    { key: "untagged", label: "Untagged", count: counts.untagged },
  ];

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={
              "px-3 py-1.5 rounded-md text-sm border transition-colors " +
              (filter === c.key
                ? "bg-ink text-cream border-ink"
                : "bg-transparent text-muted border-line hover:text-ink hover:border-muted")
            }
          >
            {c.label}
            <span className="ml-1.5 text-xs opacity-70">{c.count}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-muted text-sm italic">No tickets match this filter.</div>
      ) : (
        <GroupedBySite
          rows={filtered}
          editor={editor}
          onStateChange={applyLocalState}
        />
      )}
    </div>
  );
}

function GroupedBySite({
  rows,
  editor,
  onStateChange,
}: {
  rows: Row[];
  editor: boolean;
  onStateChange: (ticketId: string, newState: string) => void;
}) {
  // Group preserving insertion order of the first ticket per site
  const order: string[] = [];
  const bySite = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.site || "Unassigned site";
    if (!bySite.has(key)) {
      order.push(key);
      bySite.set(key, []);
    }
    bySite.get(key)!.push(r);
  }
  // Sort sites alphabetically (case-insensitive) for stable display
  order.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  return (
    <div className="space-y-6">
      {order.map((site) => (
        <section key={site}>
          <div className="flex items-baseline gap-2 mb-2">
            <h3 className="text-sm font-semibold text-ink">{site}</h3>
            <span className="text-xs text-muted">
              {bySite.get(site)!.length} ticket
              {bySite.get(site)!.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted bg-cream">
                  <th className="text-left py-2 px-3 w-16 font-medium">#</th>
                  <th className="text-left py-2 px-3 font-medium">Title</th>
                  <th className="text-left py-2 px-3 w-32 font-medium">Module</th>
                  <th className="text-left py-2 px-3 w-40 font-medium">Assignee</th>
                  <th className="text-left py-2 px-3 w-44 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {bySite.get(site)!.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-line/60 hover:bg-cream/60"
                  >
                    <td className="py-2.5 px-3 align-top">
                      {r.link ? (
                        <a
                          href={r.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {r.number ?? "—"}
                        </a>
                      ) : (
                        <span className="text-muted">{r.number ?? "—"}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 align-top">{r.title}</td>
                    <td className="py-2.5 px-3 align-top">
                      {r.module ? (
                        <span className="text-ink">{r.module}</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">
                          Untagged
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 align-top text-muted">
                      {r.assignee ?? <span className="italic">(unassigned)</span>}
                    </td>
                    <td className="py-2.5 px-3 align-top">
                      <StatusCell
                        ticketId={r.id}
                        ticketNumber={r.number}
                        currentState={r.state}
                        editor={editor}
                        onChanged={(s) => onStateChange(r.id, s)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

const ALLOWED_STATES = [
  "new",
  "waiting_on_you",
  "waiting_on_customer",
  "on_hold",
  "closed",
] as const;

function StatusCell({
  ticketId,
  ticketNumber,
  currentState,
  editor,
  onChanged,
}: {
  ticketId: string;
  ticketNumber: number | null;
  currentState: string;
  editor: boolean;
  onChanged: (newState: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pillCls =
    STATE_PILL[currentState] ??
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";
  const label = STATE_LABEL[currentState] ?? currentState;

  async function save(next: string) {
    if (next === currentState) {
      setOpen(false);
      return;
    }
    if (!editor) {
      setError("Read-only");
      return;
    }
    if (!ticketNumber) {
      setError("Missing ticket number");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: String(ticketNumber), state: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Failed (${res.status})`);
        setSaving(false);
        return;
      }
      onChanged(next);
      setOpen(false);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setSaving(false);
    }
  }

  // Read-only users get the old static pill.
  if (!editor) {
    return (
      <span className={"inline-block px-2 py-0.5 rounded text-xs border " + pillCls}>
        {label}
      </span>
    );
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className={
          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border cursor-pointer hover:opacity-80 disabled:opacity-50 " +
          pillCls
        }
        title="Click to change state"
      >
        {saving ? "Saving…" : label}
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <>
          {/* click-outside catcher */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <ul className="absolute z-50 mt-1 right-0 min-w-[12rem] rounded-md border border-line bg-card shadow-lg py-1 text-left">
            {ALLOWED_STATES.map((s) => {
              const isCurrent = s === currentState;
              const optCls =
                STATE_PILL[s] ??
                "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => save(s)}
                    disabled={saving}
                    className={
                      "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-cream " +
                      (isCurrent ? "font-semibold" : "")
                    }
                  >
                    <span className={"inline-block px-2 py-0.5 rounded text-[10px] border " + optCls}>
                      {STATE_LABEL[s] ?? s}
                    </span>
                    {isCurrent ? <span className="text-muted">· current</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {error ? (
        <div className="absolute z-50 mt-1 right-0 text-[10px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 rounded px-2 py-1 max-w-xs">
          {error}
        </div>
      ) : null}
    </span>
  );
}
