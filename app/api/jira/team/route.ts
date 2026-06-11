import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getOpenJiraIssues,
  jiraConfigured,
  jiraProjectKey,
  JiraIssue,
} from "@/lib/jira";
import { TEAM } from "@/lib/team-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MemberBandwidth = {
  id: string;
  name: string;
  initials: string;
  colorClass: string;
  count: number;
  tickets: {
    key: string;
    summary: string;
    statusName: string;
    url: string;
    updated: string | null;
  }[];
  // True if we couldn't match this person to any Jira assignee (yet).
  jiraMatchPending: boolean;
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!jiraConfigured()) {
    return NextResponse.json({
      configured: false,
      message:
        "Jira not configured — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY.",
      projectKey: jiraProjectKey() || null,
      members: TEAM.map((m) => ({
        id: m.id,
        name: m.name,
        initials: m.initials,
        colorClass: m.colorClass,
        count: 0,
        tickets: [],
        jiraMatchPending: true,
      })),
    });
  }

  try {
    const { issues, source, rawCount } = await getOpenJiraIssues();

    // Match strategy: prefer email, fall back to display-name (lowercased,
    // trimmed). Jira often hides `emailAddress` due to user privacy
    // settings, so the displayName fallback is essential.
    const byEmail = new Map<string, JiraIssue[]>();
    const byName = new Map<string, JiraIssue[]>();
    for (const it of issues) {
      const a = it.assignee;
      if (!a) continue;
      const e = a.emailAddress?.toLowerCase();
      if (e) {
        if (!byEmail.has(e)) byEmail.set(e, []);
        byEmail.get(e)!.push(it);
      }
      const n = a.displayName?.toLowerCase().trim();
      if (n) {
        if (!byName.has(n)) byName.set(n, []);
        byName.get(n)!.push(it);
      }
    }

    const members: MemberBandwidth[] = TEAM.map((m) => {
      const e = m.pylonEmail?.toLowerCase() ?? "";
      const n = m.name.toLowerCase().trim();
      const tix = (e ? byEmail.get(e) : undefined) ?? byName.get(n) ?? [];
      return {
        id: m.id,
        name: m.name,
        initials: m.initials,
        colorClass: m.colorClass,
        count: tix.length,
        tickets: tix.slice(0, 30).map((t) => ({
          key: t.key,
          summary: t.summary,
          statusName: t.statusName,
          url: t.url,
          updated: t.updated,
        })),
        jiraMatchPending: tix.length === 0,
      };
    });

    // Debug: surface every assignee we saw so unmapped folks can be added
    // to TEAM (or the matching can be tweaked here).
    const byAssignee = new Map<string, number>();
    let unassigned = 0;
    for (const it of issues) {
      if (!it.assignee) {
        unassigned++;
        continue;
      }
      const k =
        it.assignee.displayName ||
        it.assignee.emailAddress ||
        it.assignee.accountId;
      byAssignee.set(k, (byAssignee.get(k) ?? 0) + 1);
    }
    const debug = {
      endpoint: source,
      totalIssuesInProject: rawCount, // before Done filter
      openIssues: issues.length, // after Done filter (statusCategory != "done")
      unassigned,
      uniqueAssignees: Array.from(byAssignee.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
      configuredTeam: TEAM.map((m) => ({
        name: m.name,
        pylonEmail: m.pylonEmail,
      })),
    };

    return NextResponse.json({
      configured: true,
      projectKey: jiraProjectKey(),
      members,
      _debug: debug,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        configured: true,
        projectKey: jiraProjectKey(),
        error: e?.message ?? "Jira request failed",
        members: TEAM.map((m) => ({
          id: m.id,
          name: m.name,
          initials: m.initials,
          colorClass: m.colorClass,
          count: 0,
          tickets: [],
          jiraMatchPending: true,
        })),
      },
      { status: 502 }
    );
  }
}
