// Health probe for the Jira integration. Hits /myself, /project/{key},
// and runs two classic search queries so we can pinpoint whether the issue
// is auth, the project key, the JQL, or just an empty project.
//
// Hit https://<your-vercel>/api/jira/debug after deploy. Sign in first.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { jiraHealthProbe } from "@/lib/jira";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const probe = await jiraHealthProbe();
  return NextResponse.json(probe);
}
