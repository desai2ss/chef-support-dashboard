import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOpenIssuesByCustomer } from "@/lib/pylon";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!process.env.PYLON_API_KEY) {
    return NextResponse.json({
      configured: false,
      message: "PYLON_API_KEY not set. Add an Admin-created Pylon API token in your env to enable this section.",
      total: 0,
      rows: [],
      unassigned: 0,
    });
  }
  try {
    const data = await getOpenIssuesByCustomer();
    return NextResponse.json({ configured: true, ...data });
  } catch (e: any) {
    return NextResponse.json(
      { configured: true, error: e?.message ?? "Pylon request failed", total: 0, rows: [], unassigned: 0 },
      { status: 502 }
    );
  }
}
