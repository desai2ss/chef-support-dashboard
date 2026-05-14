"use client";

type Props = {
  data: {
    configured: boolean;
    summary?: { avgUptime: number | null; totalDowntime: number; totalThroughput: number; missedBowls: number; pstops: number } | null;
    rows?: any[];
    error?: string;
    message?: string;
  } | null;
};

export default function BigQueryCard({ data }: Props) {
  const s = data?.summary ?? null;
  const live = !!data?.configured;

  return (
    <section className="card mb-5">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider">BigQuery · Performance</h2>
          <div className="text-xs text-muted mt-1">Uptime · downtime · throughput · missed bowls · pstops</div>
        </div>
        <span className={"pill " + (live ? "pill-live" : "pill-pending")}>{live ? "Live" : "Awaiting BigQuery"}</span>
      </div>

      <div className="grid grid-cols-5 gap-2">
        <Tile label="Uptime" value={s?.avgUptime == null ? "—" : s.avgUptime.toFixed(1) + "%"} />
        <Tile label="Downtime" value={s ? s.totalDowntime.toLocaleString() + " min" : "—"} />
        <Tile label="Throughput" value={s ? s.totalThroughput.toLocaleString() + " bowls/hr" : "—"} />
        <Tile label="Missed bowls" value={s ? s.missedBowls.toLocaleString() : "—"} />
        <Tile label="P-stops" value={s ? s.pstops.toLocaleString() : "—"} />
      </div>

      {!live && (
        <div className="bg-cream border border-dashed border-line rounded-md p-3 text-xs text-muted mt-3">
          {data?.message ?? "Set GCP_SA_KEY_BASE64, GCP_PROJECT_ID, and BQ_METRICS_TABLE to enable. Expected columns: customer, module_id, date, uptime_pct, downtime_min, throughput, missed_bowls, pstops."}
        </div>
      )}
      {data?.error && (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3 text-sm mt-3">{data.error}</div>
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
