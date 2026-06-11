// Canonical Sites list — used by the Sites tab to map each site to its
// data sources: Pylon tickets, BigQuery sessions/robots, and schedule lines.
//
// Names here are what the UI displays. Pylon and BQ may store them slightly
// differently — `pylonNames` and `bqCustomerIds` define the matching keys.

export type SiteInfo = {
  // Canonical display name shown in the UI.
  name: string;
  // Short operating-hours label for the card subtitle.
  operatingHours: string;
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

export const SITES: SiteInfo[] = [
  {
    name: "Café Spice",
    operatingHours: "Mon-Fri · 5:00am-4:00pm",
    availableHrsPerDay: 10,
    pylonNames: ["Café Spice"],
    bqCustomerIds: ["cafespice"],
  },
  {
    name: "Amy's Medford",
    operatingHours: "Mon-Fri · 6:30am-11:00pm",
    availableHrsPerDay: 16,
    pylonNames: ["Amy's Medford"],
    bqCustomerIds: ["amys"],
    bqHostnameWhitelist: AMYS_MEDFORD_HOSTS,
  },
  {
    name: "Amy's Pocatello",
    operatingHours: "Mon-Fri · 5:30am-10:00pm",
    availableHrsPerDay: 16,
    pylonNames: ["Amy's Pocatello"],
    bqCustomerIds: ["amys"],
    bqHostnameWhitelist: AMYS_POCATELLO_HOSTS,
  },
  {
    name: "Chef Bombay",
    operatingHours: "Mon-Fri · 5:30am-10:30pm",
    availableHrsPerDay: 17,
    pylonNames: ["Chef Bombay"],
    bqCustomerIds: ["chefbombay"],
  },
  {
    name: "F&S Foods",
    operatingHours: "Mon-Sat · 3:00am-2:00pm",
    availableHrsPerDay: 10,
    pylonNames: ["F&S Foods"], // dashboard display name from pylon whitelist
    bqCustomerIds: ["fsfreshfoods"],
  },
  {
    name: "Bonduelle",
    operatingHours: "Mon-Sat · 6:30am-2:30pm",
    availableHrsPerDay: 13,
    pylonNames: ["Bonduelle"],
    bqCustomerIds: ["bonduelle"],
  },
  {
    name: "POH",
    operatingHours: "Mon-Fri · 7:00am-3:00pm",
    availableHrsPerDay: 4,
    pylonNames: ["POH"],
    bqCustomerIds: ["openhand"],
  },
  {
    name: "CookUnity LAX",
    operatingHours: "Mon-Fri · 6:30am-9:30pm",
    availableHrsPerDay: 8,
    pylonNames: ["CookUnity LAX"],
    bqCustomerIds: ["cookunity"],
    bqHostnameWhitelist: ["asimo-pc", "butter-pc", "preston-pc", "escaflowne-pc"],
  },
  {
    name: "CookUnity NYC",
    operatingHours: "Fri-Wed (closed Thu)",
    availableHrsPerDay: 8, // assume same as LAX; correct in sites-config if different
    pylonNames: ["CookUnity NYC"],
    bqCustomerIds: ["cookunity"],
    bqHostnameWhitelist: ["myrmidon-pc", "david-pc"],
  },
];
