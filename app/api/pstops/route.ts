// GET /api/pstops?from=YYYY-MM-DD&to=YYYY-MM-DD&site=Amy%27s%20Medford
//
// Reads the nightly pstop rollup (lib/pstops-rollup.ts) for one site.
// Matches the source-of-truth query: sessions whose local start date is in
// [from, to], counting only pstops that happened on or before `to`.
//
// Returns:
//   {
//     ok: true, from, to, site,
//     totalPstops, sessions,
//     perDay: [{ date, pstops, sessions }],          // by session start date
//     topModules: [{ sn, nickname, spare, pstops }], // top 5 with pstops > 0
//     topIngredients: [{ ingredient, pstops }]       // top 5 with pstops > 0
//   }

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { SITES } from "@/lib/sites-config";
import { ROBOTS } from "@/lib/fleet-config";
import { ensurePstopTables } from "@/lib/pstops-rollup";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOP_N = 5;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const site = url.searchParams.get("site") ?? "";

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from and to must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (!SITES.some((s) => s.name === site && !s.excludeFromMetrics)) {
    return NextResponse.json({ error: "unknown site" }, { status: 400 });
  }

  try {
    await ensurePstopTables();

    const sessionRows = await db
      .select({
        date: schema.pstopSessionsDaily.date,
        sessions: schema.pstopSessionsDaily.sessions,
      })
      .from(schema.pstopSessionsDaily)
      .where(
        and(
          eq(schema.pstopSessionsDaily.site, site),
          gte(schema.pstopSessionsDaily.date, from),
          lte(schema.pstopSessionsDaily.date, to)
        )
      );

    const countRows = await db
      .select({
        sessionDate: schema.pstopCountsDaily.sessionDate,
        sn: schema.pstopCountsDaily.sn,
        ingredient: schema.pstopCountsDaily.ingredient,
        pstops: schema.pstopCountsDaily.pstops,
      })
      .from(schema.pstopCountsDaily)
      .where(
        and(
          eq(schema.pstopCountsDaily.site, site),
          gte(schema.pstopCountsDaily.sessionDate, from),
          lte(schema.pstopCountsDaily.sessionDate, to),
          gte(schema.pstopCountsDaily.pstopDate, from),
          lte(schema.pstopCountsDaily.pstopDate, to)
        )
      );

    const perDayMap = new Map<string, { pstops: number; sessions: number }>();
    const day = (d: string) => {
      if (!perDayMap.has(d)) perDayMap.set(d, { pstops: 0, sessions: 0 });
      return perDayMap.get(d)!;
    };
    let sessions = 0;
    for (const r of sessionRows) {
      day(r.date).sessions += r.sessions;
      sessions += r.sessions;
    }
    let totalPstops = 0;
    const bySn = new Map<number, number>();
    const byIngredient = new Map<string, number>();
    for (const r of countRows) {
      day(r.sessionDate).pstops += r.pstops;
      totalPstops += r.pstops;
      bySn.set(r.sn, (bySn.get(r.sn) ?? 0) + r.pstops);
      byIngredient.set(r.ingredient, (byIngredient.get(r.ingredient) ?? 0) + r.pstops);
    }

    const perDay = Array.from(perDayMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const topModules = Array.from(bySn.entries())
      .filter(([, p]) => p > 0)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, TOP_N)
      .map(([sn, pstops]) => {
        const robot = ROBOTS.find((r) => r.sn === sn);
        return {
          sn,
          nickname: robot?.nickname ?? "",
          spare: !!robot?.spare,
          pstops,
        };
      });

    const topIngredients = Array.from(byIngredient.entries())
      .filter(([, p]) => p > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_N)
      .map(([ingredient, pstops]) => ({ ingredient, pstops }));

    return NextResponse.json({
      ok: true,
      from,
      to,
      site,
      totalPstops,
      sessions,
      perDay,
      topModules,
      topIngredients,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Query failed" },
      { status: 500 }
    );
  }
}
