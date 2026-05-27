"use client";

import { useEffect, useMemo, useState } from "react";

type SiteRow = {
  name: string;
  operatingHours: string;
  robots: number | null;
  utilPct: number | null;
  tickets: number;
  hasBQ: boolean;
  hasPylon: boolean;
};

type ApiResponse = {
  sites: SiteRow[];
  hasBQ: boolean;
  hasPylon: boolean;
  error?: string;
};

type State = "active" | "monitoring" | "hidden";
type StateMap = Record<string, State>;

const STATE_KEY = "chef-support-site-state-v1";
const STATES: State[] = ["active", "monitoring", "hidden"];
const STATE_LABEL: Record<State, string> = {
  active: "Active",
  monitoring: "Monitoring",
  hidden: "Hidden",
};
const STATE_PILL: Record<State, string> = {
  active:
    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/40",
  monitoring:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/40",
  hidden:
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
};

function utilTone(pct: number | null): string {
  if (pct === null) return "text-muted";
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function ticketTone(n: number): string {
  if (n === 0) return "text-muted";
  if (n <= 2) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export default function SitesView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [stateMap, setStateMap] = useState<StateMap>({});

  useEffect(() => {
    let alive = true;
    fetch("/api/sites", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setData(j))
      .catch((e) =>
        alive && setData({ sites: [], hasBQ: false, hasPylon: false, error: String(e) })
      );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) setStateMap(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(stateMap));
    } catch {}
  }, [stateMap]);

  function cycleState(siteName: string) {
    setStateMap((prev) => {
      const cur = prev[siteName] ?? "active";
      const idx = STATES.indexOf(cur);
      const next = STATES[(idx + 1) % STATES.length];
      return { ...prev, [siteName]: next };
    });
  }

  const sites = useMemo(() => data?.sites ?? [], [data]);

  if (!data) return <div className="text-muted text-sm">Loading sites…</div>;
  if (data.error) {
    return (
      <div className="text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 rounded p-3 text-sm">
        {data.error}
      </div>
    );
  }

  return (
    <div>
      {/* Heading + state legend */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Sites</h2>
        <div className="text-xs text-muted mt-1">
          Toggle site state: <em>Active</em> / <em>Monitoring</em> / <em>Hidden</em>.
          Click the badge to cycle.
        </div>
      </div>

      {/* Source-status banner if anything's missing */}
      {!data.hasBQ || !data.hasPylon ? (
        <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
          {!data.hasBQ && !data.hasPylon ? (
            <>BigQuery and Pylon are not configured — robots and tickets will show 0.</>
          ) : !data.hasBQ ? (
            <>BigQuery not configured — robot counts will show 0 until <code>GCP_SA_KEY_BASE64</code> is set.</>
          ) : (
            <>Pylon not configured — ticket counts will show 0.</>
          )}
        </div>
      ) : null}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sites.map((s) => {
          const state: State = stateMap[s.name] ?? "active";
          const dim = state === "hidden" ? "opacity-50" : "";
          return (
            <article
              key={s.name}
              className={
                "rounded-xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(0,0,0,.02)] dark:shadow-none " +
                dim
              }
            >
              <header className="flex justify-between items-start mb-1">
                <h3 className="text-base font-semibold text-ink">{s.name}</h3>
                <button
                  onClick={() => cycleState(s.name)}
                  className={
                    "inline-block px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors " +
                    STATE_PILL[state]
                  }
                  title="Click to cycle (Active → Monitoring → Hidden)"
                >
                  {STATE_LABEL[state]}
                </button>
              </header>
              <div className="text-xs text-muted mb-5">{s.operatingHours}</div>
              <div className="grid grid-cols-3 gap-4">
                <Stat
                  label="Robots"
                  value={s.robots == null ? "—" : String(s.robots)}
                  valueClass="text-ink"
                />
                <Stat
                  label="Avg util"
                  value={s.utilPct == null ? "—" : `${Math.round(s.utilPct)}%`}
                  valueClass={utilTone(s.utilPct)}
                />
                <Stat
                  label="Tickets"
                  value={String(s.tickets)}
                  valueClass={ticketTone(s.tickets)}
                />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={"text-2xl font-semibold mt-1 " + valueClass}>{value}</div>
    </div>
  );
}
