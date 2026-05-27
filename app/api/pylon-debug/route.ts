import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchRawSampleIssue,
  fetchRawIssueByNumber,
  fetchAllUsers,
  searchIssuesRaw,
} from "@/lib/pylon";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  // ?issue=9895 to fetch a specific ticket
  const issueNum = url.searchParams.get("issue") ?? "9895";

  try {
    const [sampleListIssue, singleIssue, users, searchResult] = await Promise.all([
      fetchRawSampleIssue().catch((e) => ({ error: String(e) })),
      fetchRawIssueByNumber(issueNum).catch((e) => ({ error: String(e) })),
      fetchAllUsers().catch((e) => new Map<string, any>()),
      // Try a search filtered to open + assignee set, see what the response shape looks like
      searchIssuesRaw({
        filter: {
          field: "state",
          operator: "in",
          values: ["new", "waiting_on_you", "waiting_on_customer", "on_hold"],
        },
        limit: 1,
      }).catch((e) => ({ error: String(e) })),
    ]);
    return NextResponse.json({
      // From GET /issues (list)
      list_endpoint: {
        sampleAssignee: (sampleListIssue as any)?.assignee ?? null,
        keys: (sampleListIssue as any)?.id
          ? Object.keys(sampleListIssue as any).sort()
          : null,
      },
      // From GET /issues/{num} (single)
      single_endpoint: {
        requested: issueNum,
        assignee: (singleIssue as any)?.assignee ?? null,
        state: (singleIssue as any)?.state ?? null,
        title: (singleIssue as any)?.title ?? null,
        custom_fields: (singleIssue as any)?.custom_fields ?? null,
        tags: (singleIssue as any)?.tags ?? null,
        account: (singleIssue as any)?.account ?? null,
        keys: (singleIssue as any)?.id
          ? Object.keys(singleIssue as any).sort()
          : null,
        rawError: (singleIssue as any)?.error ?? null,
      },
      // From POST /issues/search
      search_endpoint: searchResult,
      // Users so we can map assignee.id -> email
      userCount: (users as Map<string, any>).size,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Pylon error" }, { status: 502 });
  }
}
