// Pylon REST client. Uses Bearer token auth from PYLON_API_KEY.
// API docs: https://docs.usepylon.com/pylon-docs/developer/api/api-reference
//
// NOTE on the issues endpoint: Pylon's GET /issues requires `start_time` and `end_time`
// (RFC3339), max 30-day window. We default to the trailing 30 days, which gives us all
// currently-open issues since they were almost certainly created in that window.
// If you have customers with issues open longer than 30 days, page over multiple windows.

const BASE = "https://api.usepylon.com";
const OPEN_STATES = ["new", "waiting_on_you", "waiting_on_customer", "on_hold"];

type PylonIssue = {
  id: string;
  number?: number;
  account_id?: string | null;
  state: string;
  title?: string;
  created_at: string;
  latest_message_time?: string;
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
  let unassigned = 0;
  for (const issue of issues) {
    if (!issue.account_id) {
      unassigned++;
      continue;
    }
    const acc = accounts.get(issue.account_id);
    const key = acc ? acc.name : `Unknown · ${issue.account_id.slice(0, 8)}`;
    const cur = grouped.get(key) ?? {
      customer: key,
      customerId: issue.account_id,
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
  return { total: issues.length, rows, unassigned };
}
