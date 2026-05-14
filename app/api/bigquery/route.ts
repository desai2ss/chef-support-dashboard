import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { bigqueryConfigured, fetchDailyMetrics, summarize } from "@/lib/bigquery";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!bigqueryConfigured()) {
    return NextResponse.json({
      configured: false,
      message:
        "BigQuery not configured. Set GCP_SA_KEY_BASE64, GCP_PROJECT_ID, and BQ_METRICS_TABLE in Vercel env vars.",
      rows: [],
      summary: null,
    });
  }
  try {
    const rows = await fetchDailyMetrics(1);
    return NextResponse.json({ configured: true, rows, summary: summarize(rows) });
  } catch (e: any) {
    return NextResponse.json(
      { configured: true, error: e?.message ?? "BigQuery request failed", rows: [], summary: null },
      { status: 502 }
    );
  }
}
