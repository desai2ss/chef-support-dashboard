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

export default function TicketsTable() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase text-muted border-b border-line">
                <th className="text-left py-2 w-16">#</th>
                <th className="text-left py-2">Title</th>
                <th className="text-left py-2 w-32">Site</th>
                <th className="text-left py-2 w-32">Module</th>
                <th className="text-left py-2 w-40">Assignee</th>
                <th className="text-left py-2 w-44">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-line/50 hover:bg-cream/60">
                  <td className="py-2.5 align-top">
                    {r.link ? (
                      <a
                        href={r.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        {r.number ?? "—"}
                      </a>
                    ) : (
                      <span className="text-muted">{r.number ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-2.5 align-top">{r.title}</td>
                  <td className="py-2.5 align-top">{r.site}</td>
                  <td className="py-2.5 align-top">
                    {r.module ? (
                      <span className="text-ink">{r.module}</span>
                    ) : (
                      <span className="text-amber-400">Untagged</span>
                    )}
                  </td>
                  <td className="py-2.5 align-top text-muted">
                    {r.assignee ?? <span className="italic">(unassigned)</span>}
                  </td>
                  <td className="py-2.5 align-top">
                    <span
                      className={
                        "inline-block px-2 py-0.5 rounded text-xs border " +
                        (STATE_PILL[r.state] ?? "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700")
                      }
                    >
                      {STATE_LABEL[r.state] ?? r.state}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
