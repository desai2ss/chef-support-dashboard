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
  // True if this robot is a backup/spare not in active rotation. Spares
  // still appear on the Fleet view (so we can check their health) but get
  // a "Spare" badge and are excluded from "active fleet" counts.
  spare?: boolean;
};

// Robot roster. Hostnames are the BQ `sessions_v0.hostname` values; SN +
// nickname are how we display them in the UI ("SN29 eric").
export const ROBOTS: RobotConfig[] = [
  // Amy's Medford (11 robots total; SN17 is the on-site spare)
  { hostname: "chappie-pc",     sn: 4,  nickname: "chappie",     site: "Amy's Medford" },
  { hostname: "frankenstein-pc",sn: 6,  nickname: "frankenstein",site: "Amy's Medford" },
  { hostname: "toaster-pc",     sn: 17, nickname: "toaster",     site: "Amy's Medford", spare: true },
  { hostname: "sophon-pc",      sn: 23, nickname: "sophon",      site: "Amy's Medford" },
  { hostname: "burgl-pc",       sn: 24, nickname: "burgl",       site: "Amy's Medford" },
  { hostname: "tars-pc",        sn: 25, nickname: "tars",        site: "Amy's Medford" },
  { hostname: "irongiant-pc",   sn: 26, nickname: "irongiant",   site: "Amy's Medford" },
  { hostname: "flapjack-pc",    sn: 35, nickname: "flapjack",    site: "Amy's Medford" },
  { hostname: "doraemon-pc",    sn: 44, nickname: "doraemon",    site: "Amy's Medford" },
  { hostname: "baxter-pc",      sn: 49, nickname: "baxter",      site: "Amy's Medford" },
  { hostname: "ash-pc",         sn: 50, nickname: "ash",         site: "Amy's Medford" },

  // Amy's Pocatello (9 robots; SN18 redcomet is the on-site spare)
  { hostname: "redcomet-pc", sn: 18, nickname: "redcomet", site: "Amy's Pocatello", spare: true },
  { hostname: "eric-pc",     sn: 29, nickname: "eric",     site: "Amy's Pocatello" },
  { hostname: "brendan-pc",  sn: 30, nickname: "brendan",  site: "Amy's Pocatello" },
  { hostname: "case-pc",     sn: 32, nickname: "case",     site: "Amy's Pocatello" },
  { hostname: "vincent-pc",  sn: 37, nickname: "vincent",  site: "Amy's Pocatello" },
  { hostname: "pathie-pc",   sn: 43, nickname: "pathie",   site: "Amy's Pocatello" },
  { hostname: "raone-pc",    sn: 45, nickname: "raone",    site: "Amy's Pocatello" },
  { hostname: "alfred-pc",   sn: 46, nickname: "alfred",   site: "Amy's Pocatello" },
  { hostname: "angela-pc",   sn: 47, nickname: "angela",   site: "Amy's Pocatello" },

  // Café Spice (17 robots; SN11 gort is the on-site spare)
  { hostname: "gort-pc",       sn: 11, nickname: "gort",       site: "Café Spice", spare: true },
  { hostname: "rachael-pc",    sn: 19, nickname: "rachael",    site: "Café Spice" },
  { hostname: "smith-pc",      sn: 20, nickname: "smith",      site: "Café Spice" },
  { hostname: "boomer-pc",     sn: 31, nickname: "boomer",     site: "Café Spice" },
  { hostname: "mo-pc",         sn: 33, nickname: "mo",         site: "Café Spice" },
  { hostname: "voltron-pc",    sn: 34, nickname: "voltron",    site: "Café Spice" },
  { hostname: "heavyarms-pc",  sn: 38, nickname: "heavyarms",  site: "Café Spice" },
  { hostname: "calvin-pc",     sn: 39, nickname: "calvin",     site: "Café Spice" },
  { hostname: "walle-pc",      sn: 40, nickname: "walle",      site: "Café Spice" },
  { hostname: "shinatama-pc",  sn: 53, nickname: "shinatama",  site: "Café Spice" },
  { hostname: "automaton-pc",  sn: 54, nickname: "automaton",  site: "Café Spice" },
  { hostname: "metabee-pc",    sn: 55, nickname: "metabee",    site: "Café Spice" },
  { hostname: "satomi-pc",     sn: 56, nickname: "satomi",     site: "Café Spice" },
  { hostname: "roy-pc",        sn: 57, nickname: "roy",        site: "Café Spice" },
  { hostname: "grace-pc",      sn: 58, nickname: "grace",      site: "Café Spice" },
  { hostname: "chitti-pc",     sn: 59, nickname: "chitti",     site: "Café Spice" },
  { hostname: "optimus-pc",    sn: 60, nickname: "optimus",    site: "Café Spice" },

  // F&S Foods · Vineland (6 robots)
  { hostname: "pizzabagel-pc", sn: 105, nickname: "pizzabagel", site: "F&S Foods" },
  { hostname: "emily-pc",      sn: 106, nickname: "emily",      site: "F&S Foods" },
  { hostname: "dalek-pc",      sn: 107, nickname: "dalek",      site: "F&S Foods" },
  { hostname: "kipp-pc",       sn: 117, nickname: "kipp",       site: "F&S Foods" },
  { hostname: "bigo-pc",       sn: 118, nickname: "bigo",       site: "F&S Foods" },
  { hostname: "bnine-pc",      sn: 119, nickname: "bnine",      site: "F&S Foods" },

  // Chef Bombay · Nisku (6 robots)
  { hostname: "astroboy-pc",   sn: 13, nickname: "astroboy",   site: "Chef Bombay" },
  { hostname: "tinman-pc",     sn: 14, nickname: "tinman",     site: "Chef Bombay" },
  { hostname: "hal-pc",        sn: 15, nickname: "hal",        site: "Chef Bombay" },
  { hostname: "lore-pc",       sn: 16, nickname: "lore",       site: "Chef Bombay" },
  { hostname: "flexo-pc",      sn: 21, nickname: "flexo",      site: "Chef Bombay" },
  { hostname: "calculon-pc",   sn: 22, nickname: "calculon",   site: "Chef Bombay" },

  // POH (Openhand SF) (2 robots)
  { hostname: "uran-pc",       sn: 62, nickname: "uran",       site: "POH" },
  { hostname: "endy-pc",       sn: 65, nickname: "endy",       site: "POH" },

  // Bonduelle · Irwindale (3 robots)
  { hostname: "nines-pc",      sn: 109, nickname: "nines",      site: "Bonduelle" },
  { hostname: "bumblebee-pc",  sn: 111, nickname: "bumblebee",  site: "Bonduelle" },
  { hostname: "bhakti-pc",     sn: 112, nickname: "bhakti",     site: "Bonduelle" },

  // CookUnity LAX (4 robots)
  { hostname: "asimo-pc",      sn: 63, nickname: "asimo",      site: "CookUnity LAX" },
  { hostname: "butter-pc",     sn: 64, nickname: "butter",     site: "CookUnity LAX" },
  { hostname: "preston-pc",    sn: 66, nickname: "preston",    site: "CookUnity LAX" },
  { hostname: "escaflowne-pc", sn: 69, nickname: "escaflowne", site: "CookUnity LAX" },
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
  { site: "Bonduelle",       customerIds: ["bonduelle"] },
  { site: "Café Spice",      customerIds: ["cafespice"] },
  { site: "Chef Bombay",     customerIds: ["chefbombay"] },
  { site: "F&S Foods", customerIds: ["fsfreshfoods"] },
  { site: "CookUnity LAX",   customerIds: ["cookunity"] },
  { site: "POH",             customerIds: ["openhand"] },
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
