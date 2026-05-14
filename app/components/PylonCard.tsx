"use client";

type Row = { customer: string; count: number; byState: Record<string, number>; latest: string | null };
type Props = {
  data: {
    configured: boolean;
    total?: number;
    rows?: Row[];
    unassigned?: number;
    error?: string;
    message?: string;
  } | null;
};

export default function PylonCard({ data }: Props) {
  return (
    <section className="card mb-5">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider">Pylon · Open issues per customer</h2>
          <div className="text-xs text-muted mt-1">States: new, waiting_on_you, waiting_on_customer, on_hold</div>
        </div>
        <span className={"pill " + (data?.configured ? "pill-live" : "pill-pending")}>
          {data?.configured ? "Live" : "Not configured"}
        </span>
      </div>
      {!data ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : !data.configured ? (
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 text-sm">
          {data.message ?? "PYLON_API_KEY not set."}
        </div>
      ) : data.error ? (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3 text-sm">
          {data.error}
        </div>
      ) : (data.rows?.length ?? 0) === 0 ? (
        <div className="text-muted text-sm italic">No open issues with an account attached.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase text-muted">
              <th className="text-left py-1.5">Customer</th>
              <th className="text-left py-1.5 w-20">Open</th>
              <th className="text-left py-1.5">By state</th>
              <th className="text-left py-1.5 w-44">Latest activity</th>
            </tr>
          </thead>
          <tbody>
            {(data.rows ?? []).map((r) => (
              <tr key={r.customer} className="border-t border-line">
                <td className="py-1.5 font-medium">{r.customer}</td>
                <td className="py-1.5">{r.count}</td>
                <td className="py-1.5 text-muted">
                  {Object.entries(r.byState)
                    .map(([s, n]) => `${s}: ${n}`)
                    .join(" · ")}
                </td>
                <td className="py-1.5 text-muted">{r.latest ? new Date(r.latest).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.unassigned ? (
        <div className="text-xs text-muted mt-3">
          + {data.unassigned} open issue(s) with no account attached.
        </div>
      ) : null}
    </section>
  );
}
