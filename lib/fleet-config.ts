// Static config for mapping BigQuery `sessions_v0` rows to the dashboard's
// customer / site / robot taxonomy. Edit this file when robots move, new
// sites onboard, or BQ `customer_id` values change.

export type SiteConfig = {
  // Display name shown in the dashboard (e.g. "Amy's Medford")
  site: string;
  // BigQuery `customer_id` value(s) that roll up into this site. Most sites
  // have a single id; Amy's has one shared id with hostname-based splitting.
  customerIds: string[];
  // Optional: if the same customerId covers multiple sites, only count hostnames
  // in this list. If omitted, all hostnames under customerIds belong here.
  hostnameWhitelist?: string[];
};

export type RobotConfig = {
  hostname: string; // BQ value, e.g. "eric-pc"
  sn: number; // Display SN, e.g. 29
  nickname: string; // Display nickname, e.g. "eric"
  site: string; // Display site name, e.g. "Amy's Pocatello"
};

// Robot roster. Hostnames are the BQ `sessions_v0.hostname` values; SN +
// nickname are how we display them in the UI ("SN29 eric").
export const ROBOTS: RobotConfig[] = [
  // Amy's Medford (10 robots)
  { hostname: "toaster-pc",   sn: 17, nickname: "toaster",   site: "Amy's Medford" },
  { hostname: "redcomet-pc",  sn: 18, nickname: "redcomet",  site: "Amy's Medford" },
  { hostname: "sophon-pc",    sn: 23, nickname: "sophon",    site: "Amy's Medford" },
  { hostname: "burgl-pc",     sn: 24, nickname: "burgl",     site: "Amy's Medford" },
  { hostname: "tars-pc",      sn: 25, nickname: "tars",      site: "Amy's Medford" },
  { hostname: "irongiant-pc", sn: 26, nickname: "irongiant", site: "Amy's Medford" },
  { hostname: "flapjack-pc",  sn: 35, nickname: "flapjack",  site: "Amy's Medford" },
  { hostname: "doraemon-pc",  sn: 44, nickname: "doraemon",  site: "Amy's Medford" },
  { hostname: "baxter-pc",    sn: 49, nickname: "baxter",    site: "Amy's Medford" },
  { hostname: "ash-pc",       sn: 50, nickname: "ash",       site: "Amy's Medford" },

  // Amy's Pocatello (8 robots)
  { hostname: "eric-pc",     sn: 29, nickname: "eric",     site: "Amy's Pocatello" },
  { hostname: "brendan-pc",  sn: 30, nickname: "brendan",  site: "Amy's Pocatello" },
  { hostname: "case-pc",     sn: 32, nickname: "case",     site: "Amy's Pocatello" },
  { hostname: "vincent-pc",  sn: 37, nickname: "vincent",  site: "Amy's Pocatello" },
  { hostname: "pathie-pc",   sn: 43, nickname: "pathie",   site: "Amy's Pocatello" },
  { hostname: "raone-pc",    sn: 45, nickname: "raone",    site: "Amy's Pocatello" },
  { hostname: "alfred-pc",   sn: 46, nickname: "alfred",   site: "Amy's Pocatello" },
  { hostname: "angela-pc",   sn: 47, nickname: "angela",   site: "Amy's Pocatello" },
];

// Site → customer_id mapping. Amy's Medford and Pocatello share the same
// BQ customer_id ("amys") but split by hostname (see ROBOTS table above).
export const SITES: SiteConfig[] = [
  {
    site: "Amy's Medford",
    customerIds: ["amys"],
    hostnameWhitelist: ROBOTS.filter((r) => r.site === "Amy's Medford").map((r) => r.hostname),
  },
  {
    site: "Amy's Pocatello",
    customerIds: ["amys"],
    hostnameWhitelist: ROBOTS.filter((r) => r.site === "Amy's Pocatello").map((r) => r.hostname),
  },
  { site: "Bonduelle",    customerIds: ["bonduelle"] },
  { site: "Cafe Spice",   customerIds: ["cafespice"] },
  { site: "Chef Bombay",  customerIds: ["chefbombay"] },
  { site: "f&S",          customerIds: ["fsfreshfoods"] },
  { site: "Cookunity",    customerIds: ["cookunity"] },
  { site: "POH",          customerIds: ["openhand"] },
  { site: "TF Internal",  customerIds: ["taylorfarms"] },
];

// Reverse lookups built once at import time.
export const HOSTNAME_TO_ROBOT = new Map(ROBOTS.map((r) => [r.hostname, r]));

// Given a BQ customer_id + hostname, return the dashboard site (or null
// if the customer is outside our whitelist).
export function siteFor(customerId: string, hostname: string): string | null {
  for (const s of SITES) {
    if (!s.customerIds.includes(customerId)) continue;
    if (s.hostnameWhitelist && !s.hostnameWhitelist.includes(hostname)) continue;
    return s.site;
  }
  return null;
}

// All BQ customer_ids we want to pull from sessions_v0.
export const ALL_BQ_CUSTOMER_IDS = Array.from(
  new Set(SITES.flatMap((s) => s.customerIds))
);

// All hostnames we recognize.
export const KNOWN_HOSTNAMES = new Set(ROBOTS.map((r) => r.hostname));
