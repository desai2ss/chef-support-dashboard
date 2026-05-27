import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOpenTickets } from "@/lib/pylon";
import {
  fetchFleetUtilization,
  fleetConfigured,
} from "@/lib/bigquery";
import { fetchModuleHealth, datadogConfigured } from "@/lib/datadog";
import { SITES } from "@/lib/sites-config";
import { LINES } from "@/lib/schedules-config";
import { ROBOTS } from "@/lib/fleet-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SiteRow = {
  name: string;
  operatingHours: string;
  robots: number | null;
  utilPct: number | null;
  tickets: number;
  // Optional debug if something obviously off
  hasBQ: boolean;
  hasPylon: boolean;
  hasDD: boolean;
};

function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + diff);
  return out;
}

// Compute average planned utilization from the schedule for a given site.
// Sums robot-expected and total-expected across this week's cells for all
// the site's lines and returns sum(robot) / sum(total) * 100. For lines in
// "robots" mode (where robot == total by design), the planned ratio is
// always 100%, so we exclude those from the deposits-style util average
// and return them separately as "robot-line presence" (currently unused).
function scheduleUtilFor(siteName: string): number | null {
  const linesForSite = LINES.filter((l) => l.site === siteName);
  if (linesForSite.length === 0) return null;

  let totalRobot = 0;
  let totalTotal = 0;
  for (const line of linesForSite) {
    // Iterate 7 days of week — but the defaults are by day-of-week, so we
    // can just walk indices 0..6 directly without dates.
    for (let dow = 0; dow < 7; dow++) {
      const r = line.defaultRobotByDow[dow];
      const t = line.defaultTotalByDow[dow];
      if (r == null || t == null) continue;
      totalRobot += r;
      totalTotal += t;
    }
  }
  if (totalTotal === 0) return null;
  return Math.round((totalRobot / totalTotal) * 1000) / 10;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hasBQ = fleetConfigured();
  const hasPylon = !!process.env.PYLON_API_KEY;
  const hasDD = datadogConfigured();

  // Run Pylon, BQ, and Datadog in parallel; tolerate failures so the UI still renders.
  const [ticketsResult, bqResult, ddResult] = await Promise.all([
    hasPylon
      ? getOpenTickets().catch((e) => ({ error: String(e), rows: [] as any[] }))
      : Promise.resolve({ rows: [] as any[] }),
    hasBQ
      ? fetchFleetUtilization(7).catch((e) => ({ error: String(e), rows: [] as any[] }))
      : Promise.resolve({ rows: [] as any[] }),
    hasDD
      ? fetchModuleHealth().catch((e) => [])
      : Promise.resolve([] as any[]),
  ]);

  const ticketRows = (ticketsResult as any).rows ?? [];
  const bqRows = Array.isArray(bqResult) ? bqResult : [];
  const ddRows = Array.isArray(ddResult) ? ddResult : [];

  // Group tickets by their .site value (already mapped to dashboard display name)
  const ticketsBySite = new Map<string, number>();
  for (const r of ticketRows) {
    if (!r.site) continue;
    ticketsBySite.set(r.site, (ticketsBySite.get(r.site) ?? 0) + 1);
  }

  // Datadog hostname -> online flag (for site mapping via fleet-config)
  const onlineByHost = new Map<string, boolean>();
  for (const m of ddRows) {
    onlineByHost.set(m.moduleId, !!m.online);
  }

  // For each canonical site, count distinct robots seen in BQ in the last 7 days.
  // If BQ isn't configured, fall back to counting Datadog-online robots that
  // are mapped to this site via fleet-config.ts.
  const robotsBySite = new Map<string, Set<string>>();
  for (const r of bqRows) {
    if (!r.hostname || !r.customer_id) continue;
    for (const site of SITES) {
      if (!site.bqCustomerIds.includes(r.customer_id)) continue;
      if (site.bqHostnameWhitelist && !site.bqHostnameWhitelist.includes(r.hostname)) continue;
      if (!robotsBySite.has(site.name)) robotsBySite.set(site.name, new Set());
      robotsBySite.get(site.name)!.add(r.hostname);
      break;
    }
  }
  // Layer Datadog-online robots on top — same site mapping via fleet-config ROBOTS
  for (const robot of ROBOTS) {
    if (!onlineByHost.get(robot.hostname)) continue;
    if (!robotsBySite.has(robot.site)) robotsBySite.set(robot.site, new Set());
    robotsBySite.get(robot.site)!.add(robot.hostname);
  }

  const rows: SiteRow[] = SITES.map((s) => {
    // Tickets: sum across all Pylon name variants for this site.
    let ticketCount = 0;
    for (const p of s.pylonNames) {
      ticketCount += ticketsBySite.get(p) ?? 0;
    }
    const robotsSet = robotsBySite.get(s.name);
    const robotCount = robotsSet?.size ?? 0;
    return {
      name: s.name,
      operatingHours: s.operatingHours,
      // Show count if we have ANY data source (BQ or DD); show — only if both off
      robots: hasBQ || hasDD ? robotCount : null,
      utilPct: scheduleUtilFor(s.name),
      tickets: ticketCount,
      hasBQ,
      hasPylon,
      hasDD,
    };
  });

  return NextResponse.json({
    sites: rows,
    hasBQ,
    hasPylon,
    hasDD,
  });
}
