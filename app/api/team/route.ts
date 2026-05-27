import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOpenTickets, TicketRow } from "@/lib/pylon";
import { TEAM } from "@/lib/team-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MemberBandwidth = {
  id: string;
  name: string;
  initials: string;
  colorClass: string;
  pylonEmail: string | null;
  pylonIdPending: boolean;
  count: number;
  tickets: {
    number: number | null;
    title: string;
    site: string;
    state: string;
    link: string | null;
    latest: string | null;
  }[];
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.PYLON_API_KEY) {
    return NextResponse.json({
      configured: false,
      message: "PYLON_API_KEY not set — team bandwidth needs Pylon to count tickets.",
      members: TEAM.map((m) => ({
        id: m.id,
        name: m.name,
        initials: m.initials,
        colorClass: m.colorClass,
        pylonEmail: m.pylonEmail,
        pylonIdPending: !m.pylonEmail,
        count: 0,
        tickets: [],
      })),
    });
  }

  try {
    const { rows } = await getOpenTickets();
    // Group tickets by lowercased assignee email
    const byEmail = new Map<string, TicketRow[]>();
    for (const r of rows) {
      if (!r.assignee) continue;
      const key = r.assignee.toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, []);
      byEmail.get(key)!.push(r);
    }

    const members: MemberBandwidth[] = TEAM.map((m) => {
      const key = m.pylonEmail?.toLowerCase() ?? "";
      const tix = key ? byEmail.get(key) ?? [] : [];
      return {
        id: m.id,
        name: m.name,
        initials: m.initials,
        colorClass: m.colorClass,
        pylonEmail: m.pylonEmail,
        pylonIdPending: !m.pylonEmail,
        count: tix.length,
        tickets: tix.map((t) => ({
          number: t.number,
          title: t.title,
          site: t.site,
          state: t.state,
          link: t.link,
          latest: t.latest,
        })),
      };
    });

    return NextResponse.json({ configured: true, members });
  } catch (e: any) {
    return NextResponse.json(
      {
        configured: true,
        error: e?.message ?? "Pylon request failed",
        members: [],
      },
      { status: 502 }
    );
  }
}
