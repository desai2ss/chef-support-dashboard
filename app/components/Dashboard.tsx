"use client";

import { useEffect, useState } from "react";
import PylonCard from "./PylonCard";
import DatadogCard from "./DatadogCard";
import BigQueryCard from "./BigQueryCard";
import ManualEntry from "./ManualEntry";

type PylonResp = {
  configured: boolean;
  total?: number;
  rows?: { customer: string; count: number; byState: Record<string, number>; latest: string | null }[];
  unassigned?: number;
  error?: string;
  message?: string;
};

type DatadogResp = {
  configured: boolean;
  modules?: { moduleId: string; customer?: string; online: boolean; picksTotal: number | null; networkLatencyMs: number | null; lastSeen: string | null }[];
  error?: string;
  message?: string;
};

type BQResp = {
  configured: boolean;
  summary?: { avgUptime: number | null; totalDowntime: number; totalThroughput: number; missedBowls: number; pstops: number } | null;
  rows?: any[];
  error?: string;
  message?: string;
};

type CustomersResp = { customers: { id: string; name: string; weeklyHoursExpected: number }[] };
type ModulesResp = { modules: { id: string; customerId: string; name: string; status: "on-track" | "at-risk" | "blocked" | "down" }[] };
type NoteResp = { note: { date: string; knownDownText: string; updatedAt: string | null; updatedBy: string | null } };

export default function Dashboard({ editor }: { editor: boolean }) {
  const [pylon, setPylon] = useState<PylonResp | null>(null);
  const [datadog, setDatadog] = useState<DatadogResp | null>(null);
  const [bq, setBq] = useState<BQResp | null>(null);
  const [customers, setCustomers] = useState<CustomersResp["customers"]>([]);
  const [modules, setModules] = useState<ModulesResp["modules"]>([]);
  const [note, setNote] = useState<NoteResp["note"] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const reload = async () => {
    setRefreshing(true);
    const [p, d, b, c, m, n] = await Promise.all([
      fetch("/api/pylon").then((r) => r.json()).catch(() => ({ configured: false, error: "fetch failed" })),
      fetch("/api/datadog").then((r) => r.json()).catch(() => ({ configured: false, error: "fetch failed" })),
      fetch("/api/bigquery").then((r) => r.json()).catch(() => ({ configured: false, error: "fetch failed" })),
      fetch("/api/customers").then((r) => r.json()),
      fetch("/api/modules").then((r) => r.json()),
      fetch("/api/daily-note").then((r) => r.json()),
    ]);
    setPylon(p); setDatadog(d); setBq(b);
    setCustomers(c.customers ?? []);
    setModules(m.modules ?? []);
    setNote(n.note ?? null);
    setRefreshing(false);
  };

  useEffect(() => {
    reload();
    const t = setInterval(reload, 5 * 60 * 1000); // auto-refresh every 5 minutes
    return () => clearInterval(t);
  }, []);

  // top stats
  const totalPylon = pylon?.total ?? null;
  const onlineCount = datadog?.modules?.filter((m) => m.online).length ?? null;
  const totalRobots = 56;
  const avgUptime = bq?.summary?.avgUptime ?? null;
  const downCount = modules.filter((m) => m.status === "down").length;

  return (
    <>
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="stat">
          <div className="stat-label">Open Pylon issues</div>
          <div className="stat-value">{totalPylon ?? "—"}</div>
          <div className="stat-delta">{pylon?.configured ? `${pylon.rows?.length ?? 0} customers` : "not configured"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Robots online (Datadog)</div>
          <div className="stat-value">{onlineCount ?? "—"} / {totalRobots}</div>
          <div className="stat-delta">{datadog?.configured ? "live" : "awaiting credentials"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Avg uptime today (BQ)</div>
          <div className="stat-value">{avgUptime == null ? "—" : avgUptime.toFixed(1) + "%"}</div>
          <div className="stat-delta">{bq?.configured ? "live" : "awaiting credentials"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Modules flagged down</div>
          <div className="stat-value">{downCount}</div>
          <div className="stat-delta">from team input below</div>
        </div>
      </div>

      <div className="flex justify-end mb-3">
        <button className="btn-secondary" onClick={reload} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      <PylonCard data={pylon} />
      <DatadogCard data={datadog} fallbackModules={modules} customers={customers} />
      <BigQueryCard data={bq} />
      <ManualEntry
        editor={editor}
        customers={customers}
        modules={modules}
        note={note}
        onChange={reload}
      />
    </>
  );
}
