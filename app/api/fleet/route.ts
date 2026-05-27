import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchFleetUtilization, fleetConfigured } from "@/lib/bigquery";
import {
  ROBOTS,
  SITES,
  HOSTNAME_TO_ROBOT,
  siteFor,
} from "@/lib/fleet-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SiteRollup = {
  site: string;
  robotCount: number;
  onboardedCount: number;
  moduleUtilPct: number | null;
  siteTotalUtilPct: number | null;
  robots: {
    hostname: string;
    sn: number;
    nickname: string;
    buildVersion: string | null;
    utilPct: number | null;
    productionHours: number;
    totalOperatingHours: number;
    prodDate: string | null;
    onboarded: boolean;
  }[];
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!fleetConfigured()) {
    return NextResponse.json({
      configured: false,
      message: "BigQuery not configured. Set GCP_SA_KEY_BASE64 + GCP_PROJECT_ID in Vercel env.",
      sites: [],
    });
  }

  try {
    const utilRows = await fetchFleetUtilization(7);

    // Latest row per hostname (most recent prod_date).
    const latestByHost = new Map<
      string,
      (typeof utilRows)[number]
    >();
    for (const r of utilRows) {
      const cur = latestByHost.get(r.hostname);
      if (!cur || r.prod_date > cur.prod_date) {
        latestByHost.set(r.hostname, r);
      }
    }

    // Build per-site rollups from the static roster, joined with BQ data.
    const sites: SiteRollup[] = SITES.map((s) => {
      const siteRobots = ROBOTS.filter((r) => r.site === s.site);
      const rows = siteRobots.map((r) => {
        const bq = latestByHost.get(r.hostname);
        return {
          hostname: r.hostname,
          sn: r.sn,
          nickname: r.nickname,
          buildVersion: bq?.build_version ?? null,
          utilPct: bq ? Math.round(bq.module_util_pct * 10) / 10 : null,
          productionHours: bq?.production_hours ?? 0,
          totalOperatingHours: bq?.total_operating_hours ?? 0,
          prodDate: bq?.prod_date ?? null,
          onboarded: !!bq, // "onboarded" = has session data in last 7 days
        };
      });
      const withData = rows.filter((r) => r.utilPct !== null);
      const moduleUtilPct =
        withData.length === 0
          ? null
          : Math.round(
              (withData.reduce((sum, r) => sum + (r.utilPct ?? 0), 0) /
                withData.length) *
                10
            ) / 10;
      return {
        site: s.site,
        robotCount: rows.length,
        onboardedCount: rows.filter((r) => r.onboarded).length,
        moduleUtilPct,
        siteTotalUtilPct: moduleUtilPct, // TODO: distinguish once we have shift schedules
        robots: rows,
      };
    });

    // Also surface any hostnames in BQ that we don't have in the roster yet,
    // so we know to add them to fleet-config.ts.
    const unknownHostnames: { hostname: string; customer_id: string }[] = [];
    for (const row of utilRows) {
      if (!HOSTNAME_TO_ROBOT.has(row.hostname)) {
        // Only surface ones whose customer maps to one of our sites, to avoid spam.
        if (siteFor(row.customer_id, row.hostname) === null) {
          // Also note customer_ids we DO recognize but with new hostnames.
          if (
            SITES.some((s) => s.customerIds.includes(row.customer_id))
          ) {
            unknownHostnames.push({
              hostname: row.hostname,
              customer_id: row.customer_id,
            });
          }
        } else {
          unknownHostnames.push({
            hostname: row.hostname,
            customer_id: row.customer_id,
          });
        }
      }
    }

    // KPIs across the whole fleet (only counts robots with data).
    const allRobotsWithData = sites.flatMap((s) =>
      s.robots.filter((r) => r.utilPct !== null)
    );
    const fleetAvgUtil =
      allRobotsWithData.length === 0
        ? null
        : Math.round(
            (allRobotsWithData.reduce(
              (sum, r) => sum + (r.utilPct ?? 0),
              0
            ) /
              allRobotsWithData.length) *
              10
          ) / 10;

    return NextResponse.json({
      configured: true,
      sites,
      kpis: {
        fleetAvgUtilPct: fleetAvgUtil,
        robotsWithData: allRobotsWithData.length,
        totalRobots: sites.reduce((s, x) => s + x.robotCount, 0),
      },
      unknownHostnames: unknownHostnames.slice(0, 50),
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        configured: true,
        error: e?.message ?? "BigQuery request failed",
        sites: [],
      },
      { status: 502 }
    );
  }
}
