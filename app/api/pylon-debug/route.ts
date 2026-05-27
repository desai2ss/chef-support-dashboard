import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchRawSampleIssue, fetchAllUsers } from "@/lib/pylon";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const [sampleIssue, users] = await Promise.all([
      fetchRawSampleIssue(),
      fetchAllUsers(),
    ]);
    return NextResponse.json({
      sampleIssue,
      sampleIssueKeys: sampleIssue ? Object.keys(sampleIssue).sort() : null,
      assigneeRaw: sampleIssue?.assignee ?? null,
      userCount: users.size,
      userSample: Array.from(users.values()).slice(0, 10),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Pylon error" }, { status: 502 });
  }
}
