// Thin Jira Cloud client. Uses Basic auth (email + API token) and the
// enhanced search endpoint `/rest/api/3/search/jql` (the classic
// `/rest/api/3/search` was retired in 2024-2025).
//
// Env vars required:
//   JIRA_BASE_URL      e.g. https://chef.atlassian.net
//   JIRA_EMAIL         the account that owns the API token
//   JIRA_API_TOKEN     created at https://id.atlassian.com/manage-profile/security/api-tokens
//   JIRA_PROJECT_KEY   the project key, e.g. CUST
//
// Cache: in-memory module-level, 5-minute TTL, mirroring lib/pylon.ts.

const RAW_BASE = process.env.JIRA_BASE_URL || "";
const JIRA_BASE = RAW_BASE.replace(/\/$/, "");
const JIRA_EMAIL = process.env.JIRA_EMAIL || "";
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || "";
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "";

export function jiraConfigured(): boolean {
  return Boolean(JIRA_BASE && JIRA_EMAIL && JIRA_TOKEN && JIRA_PROJECT_KEY);
}

export function jiraProjectKey(): string {
  return JIRA_PROJECT_KEY;
}

function authHeader(): string {
  const b64 = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");
  return `Basic ${b64}`;
}

export type JiraAssignee = {
  accountId: string;
  displayName: string | null;
  emailAddress: string | null;
};

export type JiraIssue = {
  key: string; // "CUST-123"
  summary: string;
  statusName: string; // "In Progress"
  statusCategory: string; // "indeterminate" | "new" | "done"
  assignee: JiraAssignee | null;
  url: string; // browse link
  updated: string | null; // ISO
};

// ---- module-level cache --------------------------------------------------
let CACHE: { at: number; issues: JiraIssue[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

export function invalidateJiraCache(): void {
  CACHE = null;
}

// ---- main fetch ----------------------------------------------------------
export async function getOpenJiraIssues(): Promise<{ issues: JiraIssue[] }> {
  if (CACHE && Date.now() - CACHE.at < TTL_MS) {
    return { issues: CACHE.issues };
  }
  if (!jiraConfigured()) {
    throw new Error(
      "Jira not configured (need JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY)."
    );
  }

  const jql = `project = ${JIRA_PROJECT_KEY} AND statusCategory != Done ORDER BY updated DESC`;
  const issues: JiraIssue[] = [];

  // The enhanced search endpoint uses a `nextPageToken` cursor instead of startAt.
  let nextPageToken: string | undefined = undefined;
  // Defensive hard limit so we never spin forever on a misconfigured response.
  for (let page = 0; page < 50; page++) {
    const body: Record<string, unknown> = {
      jql,
      fields: ["summary", "status", "assignee", "updated"],
      maxResults: 100,
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const r = await fetch(`${JIRA_BASE}/rest/api/3/search/jql`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(
        `Jira search failed (${r.status} ${r.statusText}): ${txt.slice(0, 300)}`
      );
    }

    const j: any = await r.json();
    const raw: any[] = Array.isArray(j.issues) ? j.issues : [];
    for (const it of raw) {
      const f = it?.fields ?? {};
      const a = f.assignee;
      issues.push({
        key: String(it.key ?? ""),
        summary: String(f.summary ?? ""),
        statusName: String(f.status?.name ?? ""),
        statusCategory: String(f.status?.statusCategory?.key ?? ""),
        assignee: a
          ? {
              accountId: String(a.accountId ?? ""),
              displayName: a.displayName ?? null,
              emailAddress: a.emailAddress ?? null,
            }
          : null,
        url: `${JIRA_BASE}/browse/${it.key}`,
        updated: f.updated ?? null,
      });
    }

    if (j.isLast === true) break;
    if (!j.nextPageToken) break;
    nextPageToken = j.nextPageToken;
  }

  CACHE = { at: Date.now(), issues };
  return { issues };
}
