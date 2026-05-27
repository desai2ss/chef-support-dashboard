// Manual schedule config: which sites have which production lines, their
// operating hours, and the default expected deposits per weekday.
//
// Cells can be overridden per (line, date) via the UI. Overrides currently
// live in localStorage; SQLite store is a TODO once the schema's settled.

export type LineConfig = {
  // Stable id used as the localStorage override key. Don't change without
  // migrating localStorage.
  id: string;
  site: string;
  lineName: string; // "Line 2", "Line 6 North", etc.
  operatingHours: string; // "Mon-Fri · 5:00am-4:00pm"
  // Default daily deposits — Sun..Sat (index 0..6). null = no shift that day.
  defaultRobotByDow: (number | null)[];
  defaultTotalByDow: (number | null)[];
};

const MF_ONLY = (robot: number, total: number) =>
  [null, robot, robot, robot, robot, robot, null] as (number | null)[];
const MF_TOTAL = (robot: number, total: number) =>
  [null, total, total, total, total, total, null] as (number | null)[];

export const LINES: LineConfig[] = [
  // Café Spice — Mon-Fri · 5:00am-4:00pm · 10k/15k per weekday
  {
    id: "cafespice-line-2",
    site: "Cafe Spice",
    lineName: "Line 2",
    operatingHours: "Mon-Fri · 5:00am-4:00pm",
    defaultRobotByDow: MF_ONLY(10000, 15000),
    defaultTotalByDow: MF_TOTAL(10000, 15000),
  },
  {
    id: "cafespice-line-3",
    site: "Cafe Spice",
    lineName: "Line 3",
    operatingHours: "Mon-Fri · 5:00am-4:00pm",
    defaultRobotByDow: MF_ONLY(10000, 15000),
    defaultTotalByDow: MF_TOTAL(10000, 15000),
  },
  // Amy's Medford — Mon-Fri · 6:30am-11:00pm · 7.5k/10k per weekday
  {
    id: "amys-medford-line-1",
    site: "Amy's Medford",
    lineName: "Line 1",
    operatingHours: "Mon-Fri · 6:30am-11:00pm",
    defaultRobotByDow: MF_ONLY(7500, 10000),
    defaultTotalByDow: MF_TOTAL(7500, 10000),
  },
  {
    id: "amys-medford-line-2",
    site: "Amy's Medford",
    lineName: "Line 2",
    operatingHours: "Mon-Fri · 6:30am-11:00pm",
    defaultRobotByDow: MF_ONLY(7500, 10000),
    defaultTotalByDow: MF_TOTAL(7500, 10000),
  },
  // Amy's Pocatello — Mon-Fri · 5:30am-10:00pm · 5k/7k per weekday
  {
    id: "amys-pocatello-line-6-north",
    site: "Amy's Pocatello",
    lineName: "Line 6 North",
    operatingHours: "Mon-Fri · 5:30am-10:00pm",
    defaultRobotByDow: MF_ONLY(5000, 7000),
    defaultTotalByDow: MF_TOTAL(5000, 7000),
  },
  {
    id: "amys-pocatello-line-6-south",
    site: "Amy's Pocatello",
    lineName: "Line 6 South",
    operatingHours: "Mon-Fri · 5:30am-10:00pm",
    defaultRobotByDow: MF_ONLY(5000, 7000),
    defaultTotalByDow: MF_TOTAL(5000, 7000),
  },
];

// Group LINES by site, preserving order.
export function linesGroupedBySite(): { site: string; lines: LineConfig[] }[] {
  const order: string[] = [];
  const map = new Map<string, LineConfig[]>();
  for (const ln of LINES) {
    if (!map.has(ln.site)) {
      order.push(ln.site);
      map.set(ln.site, []);
    }
    map.get(ln.site)!.push(ln);
  }
  return order.map((site) => ({ site, lines: map.get(site)! }));
}
