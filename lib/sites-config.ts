// Canonical Sites list — used by the Sites tab to map each site to its
// data sources: Pylon tickets, BigQuery sessions/robots, and schedule lines.
//
// Names here are what the UI displays. Pylon and BQ may store them slightly
// differently — `pylonNames` and `bqCustomerIds` define the matching keys.

export type SiteInfo = {
  // Canonical display name shown in the UI.
  name: string;
  // IANA timezone for the site (used to compute the local production day).
  // Production day = local 2:00am to next-day 1:59am. So sessions through
  // 1:59am roll up to the previous calendar day.
  timezone: string;
  // Short operating-hours label for the card subtitle.
  operatingHours: string;
  // Days of week this site normally operates. Encoded as JS getDay() values:
  //   0=Sun  1=Mon  2=Tue  3=Wed  4=Thu  5=Fri  6=Sat
  // Used by the Metrics tab to render "—" on non-scheduled days vs "0%" on
  // scheduled days with no BQ data.
  scheduledDays: number[];
  // Production hours available per module per scheduled day. Used by the
  // Metrics rollup to compute util %: production_hours / availableHrsPerDay.
  // Mirrors the Config tab in the VC DD Stats spreadsheet.
  availableHrsPerDay: number;
  // Pylon "display names" — the values returned by displayNameFor() in lib/pylon.ts.
  // Used to filter tickets per site.
  pylonNames: string[];
  // BigQuery customer_id values from sessions_v0. Most sites have one id;
  // Amy's Medford and Pocatello share `amys` but split by hostname.
  bqCustomerIds: string[];
  // Optional: only include hostnames in this list (for sites that share a
  // BQ customer_id with another site, e.g. Amy's split).
  bqHostnameWhitelist?: string[];
  // Optional: if true, this site is excluded from the Metrics tab —
  // its sessions are skipped in the rollup, its rows hidden from the
  // read API, and it doesn't appear in the site filter dropdown. Use
  // this for sites with data quality issues or sites that shouldn't be
  // counted in fleet averages yet.
  excludeFromMetrics?: boolean;
};

const AMYS_MEDFORD_HOSTS = [
  "toaster-pc", "redcomet-pc", "sophon-pc", "burgl-pc", "tars-pc",
  "irongiant-pc", "flapjack-pc", "doraemon-pc", "baxter-pc", "ash-pc",
  "chappie-pc", "frankenstein-pc",
];
const AMYS_POCATELLO_HOSTS = [
  "eric-pc", "brendan-pc", "case-pc", "vincent-pc",
  "pathie-pc", "raone-pc", "alfred-pc", "angela-pc",
];

// Day-of-week helper sets so the SITES literal stays readable.
const MON_FRI = [1, 2, 3, 4, 5];
const MON_SAT = [1, 2, 3, 4, 5, 6];
const FRI_TUE = [5, 6, 0, 1, 2]; // Fri, Sat, Sun, Mon, Tue

export const SITES: SiteInfo[] = [
  {
    name: "Café Spice",
    timezone: "America/New_York",
    operatingHours: "Mon-Sat · 8am-6pm EST",
    scheduledDays: MON_SAT,
    availableHrsPerDay: 10,
    pylonNames: ["Café Spice"],
    bqCustomerIds: ["cafespice"],
  },
  {
    name: "Amy's Medford",
    timezone: "America/Los_Angeles",
    operatingHours: "Mon-Fri · 6am-11:59pm PST",
    scheduledDays: MON_FRI,
    availableHrsPerDay: 16,
    pylonNames: ["Amy's Medford"],
    bqCustomerIds: ["amys"],
    bqHostnameWhitelist: AMYS_MEDFORD_HOSTS,
  },
  {
    name: "Amy's Pocatello",
    timezone: "America/Boise", // Pocatello, ID is in Mountain time (no DST oddities)
    operatingHours: "Mon-Fri · 6am-11:59pm MST",
    scheduledDays: MON_FRI,
    availableHrsPerDay: 16,
    pylonNames: ["Amy's Pocatello"],
    bqCustomerIds: ["amys"],
    bqHostnameWhitelist: AMYS_POCATELLO_HOSTS,
  },
  {
    name: "Chef Bombay",
    timezone: "America/Edmonton", // Nisku, Alberta — MDT/MST
    operatingHours: "Mon-Sat",
    scheduledDays: MON_SAT,
    availableHrsPerDay: 17,
    pylonNames: ["Chef Bombay"],
    bqCustomerIds: ["chefbombay"],
  },
  {
    name: "F&S Foods",
    timezone: "America/New_York", // Vineland, NJ
    operatingHours: "Mon-Sat · 8 hrs/day",
    scheduledDays: MON_SAT,
    availableHrsPerDay: 8,
    pylonNames: ["F&S Foods"], // dashboard display name from pylon whitelist
    bqCustomerIds: ["fsfreshfoods"],
  },
  {
    name: "Bonduelle",
    timezone: "America/Los_Angeles", // Irwindale, CA
    operatingHours: "Mon-Sat",
    scheduledDays: MON_SAT,
    availableHrsPerDay: 16,
    pylonNames: ["Bonduelle"],
    bqCustomerIds: ["bonduelle"],
  },
  {
    name: "POH",
    timezone: "America/Los_Angeles", // Openhand SF
    operatingHours: "Mon-Fri",
    scheduledDays: MON_FRI,
    availableHrsPerDay: 4,
    pylonNames: ["POH"],
    bqCustomerIds: ["openhand"],
  },
  {
    name: "CookUnity LAX",
    timezone: "America/Los_Angeles",
    operatingHours: "Fri-Tue · 11 hrs/day (closed Wed/Thu)",
    scheduledDays: FRI_TUE,
    availableHrsPerDay: 11,
    pylonNames: ["CookUnity LAX"],
    bqCustomerIds: ["cookunity"],
    bqHostnameWhitelist: ["asimo-pc", "butter-pc", "preston-pc", "escaflowne-pc"],
  },
  {
    name: "Taylor Farms",
    timezone: "America/Los_Angeles", // Tracy, CA
    operatingHours: "Mon-Sat",
    scheduledDays: MON_SAT,
    availableHrsPerDay: 17,
    pylonNames: ["Taylor Farms"],
    bqCustomerIds: ["taylorfarms"],
  },
  {
    // Excluded from the Metrics tab — rollup skips these robots, read API
    // hides them, and they don't appear in the site dropdown. Still listed
    // in fleet-config so Fleet/Tickets/Sites views show them normally.
    name: "CookUnity NYC",
    timezone: "America/New_York",
    operatingHours: "Fri-Wed (closed Thu)",
    scheduledDays: [5, 6, 0, 1, 2, 3], // Fri-Wed (placeholder; not used since excluded)
    availableHrsPerDay: 8,
    pylonNames: ["CookUnity NYC"],
    bqCustomerIds: ["cookunity"],
    bqHostnameWhitelist: ["myrmidon-pc", "david-pc"],
    excludeFromMetrics: true,
  },
];

// Helper: returns true if a given date (YYYY-MM-DD) falls on one of the site's
// scheduled operating days. Used by the Metrics tab to distinguish a
// non-scheduled day (render "—") from a scheduled day with no data (render "0%").
export function isDayScheduled(siteName: string, yyyyMmDd: string): boolean {
  const site = SITES.find((s) => s.name === siteName);
  if (!site) return true; // unknown site: don't dash out cells
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return true;
  const dow = new Date(y, m - 1, d).getDay();
  return site.scheduledDays.includes(dow);
}
