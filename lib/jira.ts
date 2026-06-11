// Thin Jira Cloud client. Uses Basic auth (email + API token).
//
// Endpoint strategy:
//   We call the classic `/rest/api/3/search` first (still supported on every
//   Cloud site as of mid-2026) and fall back to the new
//   `/rest/api/3/search/jql` if classic ever returns 410 Gone. The classic
//   endpoint is what every Atlassian doc/example still shows, and we hit a
//   silent-empty-result issue using the new endpoint on this site.
//
// JQL strategy:
//   We pull ALL issues in the project (no statusCategory filter) and filter
//   "Done" in JS by inspecting `fields.status.statusCategory.key`. That keeps
//   the JQL trivially valid even if a project has weird status mappings.
//
// Env vars required:
//   JIRA_BASE_URL      e.g. https://chef.atlassian.net
//   JIRA_EMAIL         the account that owns the API token
//   JIRA_API_TOKEN     created at https://id.atlassian.com/manage-profile/security/api-tokens
//   JIRA_PROJECT_KEY   the project key, e.g. CUST
//
// Cache: in-memory module-level, 5-minute TTL.

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
  key: string;
  summary: string;
  statusName: string;
  statusCategory: string; // "done" | "indeterminate" | "new"
  assignee: JiraAssignee | null;
  url: string;
  updated: string | null;
};

// ---- module-level cache --------------------------------------------------
let CACHE: { at: number; issues: JiraIssue[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

export function invalidateJiraCache(): void {
  CACHE = null;
}

// ---- HTTP helpers --------------------------------------------------------
async function fetchClassicSearch(
  jql: string,
  startAt: number,
  maxResults: number
): Promise<{ status: number; ok: boolean; body: any; text?: string }> {
  const u = new URL(`${JIRA_BASE}/rest/api/3/search`);
  u.searchParams.set("jql", jql);
  u.searchParams.set("startAt", String(startAt));
  u.searchParams.set("maxResults", String(maxResults));
  u.searchParams.set("fields", "summary,status,assignee,updated");

  const r = await fetch(u.toString(), {
    method: "GET",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await r.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: r.status, ok: r.ok, body, text };
}

async function fetchEnhancedSearch(
  jql: string,
  nextPageToken: string | undefined,
  maxResults: number
): Promise<{ status: number; ok: boolean; body: any; text?: string }> {
  const body: Record<string, unknown> = {
    jql,
    fields: ["summary", "status", "assignee", "updated"],
    maxResults,
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
  const text = await r.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: r.status, ok: r.ok, body: parsed, text };
}

function rawIssueToJiraIssue(it: any): JiraIssue {
  const f = it?.fields ?? {};
  const a = f.assignee;
  return {
    key: String(it.key ?? ""),
    summary: String(f.summary ?? ""),
    statusName: String(f.status?.name ?? ""),
    statusCategory: String(f.status?.statusCategory?.key ?? "").toLowerCase(),
    assignee: a
      ? {
          accountId: String(a.accountId ?? ""),
          displayName: a.displayName ?? null,
          emailAddress: a.emailAddress ?? null,
        }
      : null,
    url: `${JIRA_BASE}/browse/${it.key}`,
    updated: f.updated ?? null,
  };
}

// ---- main fetch (open issues = not in statusCategory "done") -------------
// Uses ONLY the enhanced `/rest/api/3/search/jql` endpoint — the classic
// `/rest/api/3/search` was retired by Atlassian in 2026 (returns 410).
export async function getOpenJiraIssues(): Promise<{
  issues: JiraIssue[];
  source: "enhanced";
  rawCount: number; // total returned by Jira before "Done" filter
}> {
  if (CACHE && Date.now() - CACHE.at < TTL_MS) {
    return {
      issues: CACHE.issues,
      source: "enhanced",
      rawCount: CACHE.issues.length,
    };
  }
  if (!jiraConfigured()) {
    throw new Error(
      "Jira not configured (need JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY)."
    );
  }

  // Pull every issue in the project — we filter Done in JS so we don't
  // depend on JQL status-category syntax quirks.
  const jql = `project = "${JIRA_PROJECT_KEY}" ORDER BY updated DESC`;
  const allRaw: any[] = [];

  let nextPageToken: string | undefined = undefined;
  for (let page = 0; page < 50; page++) {
    const r = await fetchEnhancedSearch(jql, nextPageToken, 100);
    if (!r.ok) {
      const msg =
        (r.body && (r.body.errorMessages?.join("; ") || r.body.message)) ||
        r.text ||
        `Jira search failed (HTTP ${r.status})`;
      throw new Error(`Jira search ${r.status}: ${String(msg).slice(0, 300)}`);
    }
    const issuesPage: any[] = Array.isArray(r.body?.issues)
      ? r.body.issues
      : [];
    allRaw.push(...issuesPage);
    if (r.body?.isLast === true) break;
    if (!r.body?.nextPageToken) break;
    nextPageToken = r.body.nextPageToken;
  }

  const rawCount = allRaw.length;
  const all = allRaw.map(rawIssueToJiraIssue);
  const issues = all.filter((it) => it.statusCategory !== "done");

  CACHE = { at: Date.now(), issues };
  return { issues, source: "enhanced", rawCount };
}

// ---- standalone health probe (used by /api/jira/debug) -------------------
// Hits /myself, /project/{key}, and runs one search against the enhanced
// endpoint so we can tell whether the issue is auth, project key, or scope.
export async function jiraHealthProbe(): Promise<{
  configured: boolean;
  baseUrl: string;
  email: string;
  projectKey: string;
  myself: { ok: boolean; status: number; body?: any; error?: string };
  project: { ok: boolean; status: number; body?: any; error?: string };
  enhancedSearchAny: {
    ok: boolean;
    status: number;
    returned?: number;
    sample?: any[];
    isLast?: boolean;
    error?: string;
  };
}> {
  const out: any = {
    configured: jiraConfigured(),
    baseUrl: JIRA_BASE,
    email: JIRA_EMAIL,
    projectKey: JIRA_PROJECT_KEY,
    myself: { ok: false, status: 0 },
    project: { ok: false, status: 0 },
    enhancedSearchAny: { ok: false, status: 0 },
  };

  // /myself
  try {
    const r = await fetch(`${JIRA_BASE}/rest/api/3/myself`, {
      headers: { Authorization: authHeader(), Accept: "application/json" },
      cache: "no-store",
    });
    out.myself.status = r.status;
    out.myself.ok = r.ok;
    const j = await r.json().catch(() => null);
    if (j) {
      out.myself.body = {
        emailAddress: j.emailAddress ?? null,
        displayName: j.displayName ?? null,
        accountId: j.accountId ?? null,
      };
    }
  } catch (e: any) {
    out.myself.error = e?.message ?? String(e);
  }

  // /project/{key}
  try {
    const r = await fetch(
      `${JIRA_BASE}/rest/api/3/project/${encodeURIComponent(JIRA_PROJECT_KEY)}`,
      {
        headers: { Authorization: authHeader(), Accept: "application/json" },
        cache: "no-store",
      }
    );
    out.project.status = r.status;
    out.project.ok = r.ok;
    const j = await r.json().catch(() => null);
    if (j) {
      out.project.body = { key: j.key, name: j.name, id: j.id };
    }
  } catch (e: any) {
    out.project.error = e?.message ?? String(e);
  }

  // enhanced search — every issue in project (first page only)
  try {
    const r = await fetchEnhancedSearch(
      `project = "${JIRA_PROJECT_KEY}" ORDER BY updated DESC`,
      undefined,
      5
    );
    out.enhancedSearchAny.status = r.status;
    out.enhancedSearchAny.ok = r.ok;
    if (r.ok) {
      const issues = r.body?.issues ?? [];
      out.enhancedSearchAny.returned = issues.length;
      out.enhancedSearchAny.isLast = r.body?.isLast ?? null;
      out.enhancedSearchAny.sample = issues.map((it: any) => ({
        key: it.key,
        status: it.fields?.status?.name,
        statusCategory: it.fields?.status?.statusCategory?.key,
        assignee: it.fields?.assignee?.displayName ?? null,
      }));
    } else {
      out.enhancedSearchAny.error =
        r.body?.errorMessages?.join("; ") ?? r.text ?? `HTTP ${r.status}`;
    }
  } catch (e: any) {
    out.enhancedSearchAny.error = e?.message ?? String(e);
  }

  return out;
}
