"use client";

type DDModule = {
  moduleId: string;
  customer?: string;
  online: boolean;
  picksTotal: number | null;
  networkLatencyMs: number | null;
  lastSeen: string | null;
};
type ManualModule = { id: string; customerId: string; name: string; status: "on-track" | "at-risk" | "blocked" | "down" };
type Customer = { id: string; name: string; weeklyHoursExpected: number };
type Props = {
  data: { configured: boolean; modules?: DDModule[]; error?: string; message?: string } | null;
  fallbackModules: ManualModule[];
  customers: Customer[];
};

export default function DatadogCard({ data, fallbackModules, customers }: Props) {
  const live = data?.configured && (data.modules?.length ?? 0) > 0;

  return (
    <section className="card mb-5">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider">Datadog · Module health</h2>
          <div className="text-xs text-muted mt-1">Network speed per module · total picks · online/offline · 56 robots across 14 customers</div>
        </div>
        <span className={"pill " + (live ? "pill-live" : "pill-pending")}>{live ? "Live" : "Awaiting Datadog"}</span>
      </div>

      {data?.error ? (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3 text-sm mb-3">{data.error}</div>
      ) : null}

      {live ? (
        <LiveGrid modules={data!.modules!} />
      ) : (
        <FallbackGrid modules={fallbackModules} customers={customers} message={data?.message} />
      )}
    </section>
  );
}

function LiveGrid({ modules }: { modules: DDModule[] }) {
  const byCust = new Map<string, DDModule[]>();
  for (const m of modules) {
    const key = m.customer ?? "—";
    if (!byCust.has(key)) byCust.set(key, []);
    byCust.get(key)!.push(m);
  }
  return (
    <div className="space-y-4">
      {Array.from(byCust.entries()).map(([cust, mods]) => (
        <div key={cust}>
          <div className="font-medium text-sm mb-1.5">{cust}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
            {mods.map((m) => (
              <div key={m.moduleId} className={"border rounded-md p-2 text-xs " + (m.online ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50")}>
                <div className="font-semibold">{m.moduleId}</div>
                <div className="text-muted">picks 1h: {m.picksTotal ?? "—"}</div>
                <div className="text-muted">net: {m.networkLatencyMs == null ? "—" : m.networkLatencyMs.toFixed(0) + " ms"}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FallbackGrid({ modules, customers, message }: { modules: ManualModule[]; customers: Customer[]; message?: string }) {
  const byCustId = new Map<string, ManualModule[]>();
  for (const m of modules) {
    if (!byCustId.has(m.customerId)) byCustId.set(m.customerId, []);
    byCustId.get(m.customerId)!.push(m);
  }
  const custName = (id: string) => customers.find((c) => c.id === id)?.name ?? "—";

  return (
    <>
      <div className="bg-cream border border-dashed border-line rounded-md p-3 text-xs text-muted mb-3">
        {message ?? "Datadog not wired yet. Tiles below reflect team-entered status from the manual section. Set DATADOG_API_KEY / DATADOG_APP_KEY to enable live picks + network latency per module."}
      </div>
      {modules.length === 0 ? (
        <div className="text-muted text-sm italic">No modules yet. Add some in the team-input section below.</div>
      ) : (
        <div className="space-y-4">
          {Array.from(byCustId.entries()).map(([cid, mods]) => (
            <div key={cid}>
              <div className="font-medium text-sm mb-1.5">{custName(cid)}</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
                {mods.map((m) => {
                  const cls =
                    m.status === "down" ? "border-red-300 bg-red-50" :
                    m.status === "on-track" ? "border-green-300 bg-green-50" :
                    m.status === "at-risk" ? "border-amber-300 bg-amber-50" :
                    "border-purple-300 bg-purple-50";
                  return (
                    <div key={m.id} className={"border rounded-md p-2 text-xs " + cls}>
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-muted">status: {m.status}</div>
                      <div className="text-muted">picks: — · net: —</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
