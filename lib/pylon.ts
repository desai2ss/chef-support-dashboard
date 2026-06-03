// Pylon REST client. Uses Bearer token auth from PYLON_API_KEY.
// API docs: https://docs.usepylon.com/pylon-docs/developer/api/api-reference
//
// NOTE on the issues endpoint: Pylon's GET /issues requires `start_time` and `end_time`
// (RFC3339), max 30-day window. We default to the trailing 30 days, which gives us all
// currently-open issues since they were almost certainly created in that window.
// If you have customers with issues open longer than 30 days, page over multiple windows.

const BASE = "https://api.usepylon.com";
const OPEN_STATES = ["new", "waiting_on_you", "waiting_on_customer", "on_hold"];

// Whitelist of customers we care about. Pylon account names may differ slightly
// in casing/punctuation/suffix (e.g. "Cookunity" vs "CookUnity LA", "F&S Foods"
// vs "F&S Fresh Foods", "Cafe Spice" vs "CafeSpice"), so we match with normalize() below.
const CUSTOMER_WHITELIST = [
  "F&S Foods",
  "Amy's Medford",
  "Amy's Pocatello",
  "Chef Bombay",
  "Café Spice",
  "Bonduelle",
  "POH",
  "Taylor Farms",
  "CookUnity LAX",
];

// Lowercase, strip diacritics + non-alphanumerics so "Café Spice" / "Cafe Spice" /
// "CafeSpice" / "cafe-spice" all collapse to "cafespice". The NFD + combining-mark
// strip is what lets "é" match "e".
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const WHITELIST_NORM = CUSTOMER_WHITELIST.map(normalize);

// Either name is a prefix/contains-match of the other after normalization.
function matchesWhitelist(name: string): boolean {
  const n = normalize(name);
  return WHITELIST_NORM.some((w) => n === w || n.startsWith(w) || w.startsWith(n));
}

// Map a Pylon account name to the canonical dashboard display name (one of
// CUSTOMER_WHITELIST entries). Returns the original name if no match.
function displayNameFor(pylonName: string): string {
  const n = normalize(pylonName);
  for (let i = 0; i < WHITELIST_NORM.length; i++) {
    const w = WHITELIST_NORM[i];
    if (n === w || n.startsWith(w) || w.startsWith(n)) {
      return CUSTOMER_WHITELIST[i];
    }
  }
  return pylonName;
}

type PylonIssue = {
  id: string;
  number?: number;
  // Pylon's API returns a nested MiniAccount object ({ id, external_ids })
  // — NOT a top-level account_id. We extract account.id below.
  account?: { id: string } | null;
  assignee?: { id: string; email?: string } | null;
  state: string;
  title?: string;
  created_at: string;
  latest_message_time?: string;
  link?: string;
  tags?: string[];
  custom_fields?: Record<string, { slug: string; value?: string; values?: string[] }>;
};

type PylonAccount = {
  id: string;
  name: string;
  domain?: string;
};

function headers() {
  const key = process.env.PYLON_API_KEY;
  if (!key) throw new Error("PYLON_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function pylonGet<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, v);
  }
  const url = `${BASE}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pylon ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

type IssuesPage = {
  data?: PylonIssue[];
  issues?: PylonIssue[];
  cursor?: string;
  has_next_page?: boolean;
  pagination?: { cursor?: string; has_next_page?: boolean };
};

type AccountsPage = {
  data?: PylonAccount[];
  accounts?: PylonAccount[];
  cursor?: string;
  has_next_page?: boolean;
  pagination?: { cursor?: string; has_next_page?: boolean };
};

// Fetch a single issue by number using GET /issues/{number}. For debug.
export async function fetchRawIssueByNumber(num: string): Promise<any> {
  const key = process.env.PYLON_API_KEY;
  if (!key) throw new Error("PYLON_API_KEY is not set");
  const res = await fetch(`${BASE}/issues/${num}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pylon /issues/${num}: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

// Search issues by filter. POST /issues/search. For debug.
export async function searchIssuesRaw(body: any): Promise<any> {
  const key = process.env.PYLON_API_KEY;
  if (!key) throw new Error("PYLON_API_KEY is not set");
  const res = await fetch(`${BASE}/issues/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 2000) };
}

// Update an existing issue's state. Pylon accepts the issue number OR UUID as :id.
// Pass one of: "new", "waiting_on_you", "waiting_on_customer", "on_hold", "closed",
// or a custom-status slug defined in the Pylon workspace.
export async function updateIssueState(
  issueNumberOrId: string,
  newState: string
): Promise<void> {
  const key = process.env.PYLON_API_KEY;
  if (!key) throw new Error("PYLON_API_KEY is not set");
  const res = await fetch(`${BASE}/issues/${issueNumberOrId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ state: newState }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Pylon PATCH /issues/${issueNumberOrId} ${res.status}: ${body.slice(0, 300)}`
    );
  }
  // Cached list is now stale — drop it so the next read pulls fresh state.
  invalidateTicketsCache();
}

// Returns the raw first issue from the API (no parsing/filtering). For debug only.
export async function fetchRawSampleIssue(): Promise<any> {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const resp = await pylonGet<any>("/issues", {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    limit: "1",
  });
  const list = resp.issues ?? resp.data ?? [];
  return list[0] ?? null;
}

// Fetches all users from Pylon. Used to resolve assignee.id -> email if the
// list /issues response doesn't expand assignee details.
export async function fetchAllUsers(): Promise<Map<string, { id: string; email?: string; name?: string }>> {
  const out = new Map<string, { id: string; email?: string; name?: string }>();
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const resp: any = await pylonGet<any>("/users", { limit: "100", cursor });
    const users: any[] = resp.users ?? resp.data ?? [];
    for (const u of users) {
      out.set(u.id, { id: u.id, email: u.email, name: u.name });
    }
    const nextCursor: string | undefined = resp.cursor ?? resp.pagination?.cursor;
    const hasNext: boolean | undefined = resp.has_next_page ?? resp.pagination?.has_next_page;
    if (!hasNext || !nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

export async function fetchOpenIssuesLast30Days(): Promise<PylonIssue[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startStr = start.toISOString();
  const endStr = end.toISOString();
  const out: PylonIssue[] = [];
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const resp: IssuesPage = await pylonGet<IssuesPage>("/issues", {
      start_time: startStr,
      end_time: endStr,
      limit: "100",
      cursor,
    });
    const issues: PylonIssue[] = resp.issues ?? resp.data ?? [];
    out.push(...issues);
    const nextCursor: string | undefined = resp.cursor ?? resp.pagination?.cursor;
    const hasNext: boolean | undefined = resp.has_next_page ?? resp.pagination?.has_next_page;
    if (!hasNext || !nextCursor) break;
    cursor = nextCursor;
  }
  return out.filter((i) => OPEN_STATES.includes(i.state));
}

export async function fetchAllAccounts(): Promise<Map<string, PylonAccount>> {
  const out = new Map<string, PylonAccount>();
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const resp: AccountsPage = await pylonGet<AccountsPage>("/accounts", { limit: "100", cursor });
    const accounts: PylonAccount[] = resp.accounts ?? resp.data ?? [];
    for (const a of accounts) out.set(a.id, a);
    const nextCursor: string | undefined = resp.cursor ?? resp.pagination?.cursor;
    const hasNext: boolean | undefined = resp.has_next_page ?? resp.pagination?.has_next_page;
    if (!hasNext || !nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

export type OpenIssueAggregate = {
  customer: string;
  customerId: string | null;
  count: number;
  byState: Record<string, number>;
  latest: string | null;
};

// Common custom-field slugs that might carry the "Module" / robot SN.
// We try each in order until we find a value.
const MODULE_FIELD_CANDIDATES = ["module", "robot", "robot_sn", "serial_number", "sn"];

// Values that Pylon stores when "N/A / don't know" is selected on the Module
// dropdown. Treat these as untagged for the dashboard.
const UNTAGGED_MODULE_VALUES = new Set([
  "n_a_or_don_t_know",
  "n/a",
  "na",
  "none",
  "unknown",
]);

function readModule(issue: PylonIssue): string | null {
  const cf = issue.custom_fields ?? {};
  for (const slug of MODULE_FIELD_CANDIDATES) {
    const v = cf[slug];
    if (!v) continue;
    // Pylon stores the slug in `values` (array) for SELECT custom fields,
    // and leaves `value` as "". Prefer `values` first.
    let raw: string | null = null;
    if (v.values && v.values.length > 0) {
      raw = v.values.join(", ");
    } else if (v.value && v.value.length > 0) {
      raw = v.value;
    }
    if (!raw) continue;
    if (UNTAGGED_MODULE_VALUES.has(raw.toLowerCase())) return null;
    return raw;
  }
  return null;
}

export type TicketRow = {
  id: string;
  number: number | null;
  title: string;
  site: string; // customer / account name
  module: string | null;
  assignee: string | null; // email
  state: string;
  link: string | null;
  latest: string | null;
  createdAt: string | null; // ISO timestamp; used to flag "new in last 24h"
  tags: string[];
};

// Pylon's GET /issues (list) endpoint returns `assignee: null` on every issue
// even when an assignee is set. To get the real assignee, we hit GET /issues/{num}
// per ticket and pull the assignee.id, then resolve to email via the /users map.
async function enrichIssuesWithAssignee(
  issues: PylonIssue[]
): Promise<PylonIssue[]> {
  const CHUNK = 8;
  const out: PylonIssue[] = [];
  for (let i = 0; i < issues.length; i += CHUNK) {
    const chunk = issues.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(async (issue) => {
        if (!issue.number) return issue;
        try {
          const full = await fetchRawIssueByNumber(String(issue.number));
          return { ...issue, assignee: full?.assignee ?? null };
        } catch {
          return issue;
        }
      })
    );
    out.push(...results);
  }
  return out;
}

// In-memory cache for the enriched ticket list. The expensive part is the
// N+1 fetches done by enrichIssuesWithAssignee (~3-5s for 41 tickets). The
// Tickets, Team, and Sites tabs all consume this; without caching each page
// load pays the full cost. 60s TTL is a reasonable balance between freshness
// and snappy navigation.
const TICKETS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let ticketsCache: {
  ts: number;
  data: { total: number; rows: TicketRow[] };
} | null = null;

export function invalidateTicketsCache() {
  ticketsCache = null;
}

export async function getOpenTickets(): Promise<{
  total: number;
  rows: TicketRow[];
}> {
  if (ticketsCache && Date.now() - ticketsCache.ts < TICKETS_CACHE_TTL_MS) {
    return ticketsCache.data;
  }
  const [issuesRaw, accounts, users] = await Promise.all([
    fetchOpenIssuesLast30Days(),
    fetchAllAccounts(),
    fetchAllUsers(),
  ]);
  // List endpoint doesn't include assignee — enrich each one via GET /issues/{num}.
  const issues = await enrichIssuesWithAssignee(issuesRaw);

  const rows: TicketRow[] = [];
  for (const issue of issues) {
    const accountId = issue.account?.id ?? null;
    if (!accountId) continue;
    const acc = accounts.get(accountId);
    if (!acc) continue;
    if (!matchesWhitelist(acc.name)) continue;
    // Resolve assignee email via /users id->email map since the issue
    // endpoint only returns assignee.id.
    let assigneeEmail: string | null = issue.assignee?.email ?? null;
    if (!assigneeEmail && issue.assignee?.id) {
      const u = users.get(issue.assignee.id);
      assigneeEmail = u?.email ?? null;
    }
    rows.push({
      id: issue.id,
      number: issue.number ?? null,
      title: issue.title ?? "(no title)",
      site: displayNameFor(acc.name),
      module: readModule(issue),
      assignee: assigneeEmail,
      state: issue.state,
      link: issue.link ?? null,
      latest: issue.latest_message_time ?? issue.created_at ?? null,
      createdAt: issue.created_at ?? null,
      tags: issue.tags ?? [],
    });
  }
  // Sort by latest activity desc
  rows.sort((a, b) => (b.latest ?? "").localeCompare(a.latest ?? ""));
  const result = { total: rows.length, rows };
  ticketsCache = { ts: Date.now(), data: result };
  return result;
}

export async function getOpenIssuesByCustomer(): Promise<{
  total: number;
  rows: OpenIssueAggregate[];
  unassigned: number;
}> {
  const [issues, accounts] = await Promise.all([
    fetchOpenIssuesLast30Days(),
    fetchAllAccounts(),
  ]);

  const grouped = new Map<string, OpenIssueAggregate>();
  for (const issue of issues) {
    const accountId = issue.account?.id ?? null;
    if (!accountId) continue; // skip issues with no account
    const acc = accounts.get(accountId);
    if (!acc) continue; // skip if we can't resolve the account name
    if (!matchesWhitelist(acc.name)) continue; // only whitelisted customers
    const key = acc.name;
    const cur = grouped.get(key) ?? {
      customer: key,
      customerId: accountId,
      count: 0,
      byState: {},
      latest: null,
    };
    cur.count++;
    cur.byState[issue.state] = (cur.byState[issue.state] ?? 0) + 1;
    const t = issue.latest_message_time ?? issue.created_at;
    if (!cur.latest || t > cur.latest) cur.latest = t;
    grouped.set(key, cur);
  }
  const rows = Array.from(grouped.values()).sort((a, b) => b.count - a.count);
  const total = rows.reduce((s, r) => s + r.count, 0);
  return { total, rows, unassigned: 0 };
}
