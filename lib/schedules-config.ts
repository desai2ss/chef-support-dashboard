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

// Helper: build a day-of-week array for Mon-Fri only (5 days, weekends null).
// Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6.
function MF(weekday: number): (number | null)[] {
  return [null, weekday, weekday, weekday, weekday, weekday, null];
}

// Helper: Mon-Sat with optionally different Saturday value.
function MS(weekday: number, saturday: number): (number | null)[] {
  return [null, weekday, weekday, weekday, weekday, weekday, saturday];
}

export const LINES: LineConfig[] = [
  // Cafe Spice — Mon-Fri · 5:00am-4:00pm · 10k/15k
  {
    id: "cafespice-line-2",
    site: "Cafe Spice",
    lineName: "Line 2",
    operatingHours: "Mon-Fri · 5:00am-4:00pm",
    defaultRobotByDow: MF(10000),
    defaultTotalByDow: MF(15000),
  },
  {
    id: "cafespice-line-3",
    site: "Cafe Spice",
    lineName: "Line 3",
    operatingHours: "Mon-Fri · 5:00am-4:00pm",
    defaultRobotByDow: MF(10000),
    defaultTotalByDow: MF(15000),
  },
  // Amy's Medford — Mon-Fri · 6:30am-11:00pm · 7.5k/10k
  {
    id: "amys-medford-line-1",
    site: "Amy's Medford",
    lineName: "Line 1",
    operatingHours: "Mon-Fri · 6:30am-11:00pm",
    defaultRobotByDow: MF(7500),
    defaultTotalByDow: MF(10000),
  },
  {
    id: "amys-medford-line-2",
    site: "Amy's Medford",
    lineName: "Line 2",
    operatingHours: "Mon-Fri · 6:30am-11:00pm",
    defaultRobotByDow: MF(7500),
    defaultTotalByDow: MF(10000),
  },
  // Amy's Pocatello — Mon-Fri · 5:30am-10:00pm · 5k/7k
  {
    id: "amys-pocatello-line-6-north",
    site: "Amy's Pocatello",
    lineName: "Line 6 North",
    operatingHours: "Mon-Fri · 5:30am-10:00pm",
    defaultRobotByDow: MF(5000),
    defaultTotalByDow: MF(7000),
  },
  {
    id: "amys-pocatello-line-6-south",
    site: "Amy's Pocatello",
    lineName: "Line 6 South",
    operatingHours: "Mon-Fri · 5:30am-10:00pm",
    defaultRobotByDow: MF(5000),
    defaultTotalByDow: MF(7000),
  },

  // Chef Bombay — 1 line · Mon-Fri · 5:30am-10:30pm · 6k/8k
  {
    id: "chef-bombay-line-1",
    site: "Chef Bombay",
    lineName: "Line 1",
    operatingHours: "Mon-Fri · 5:30am-10:30pm",
    defaultRobotByDow: MF(6000),
    defaultTotalByDow: MF(8000),
  },

  // F&S Fresh Foods — 2 lines · Mon-Sat · 3:00am-2:00pm
  // Mon-Fri: 5k/7k · Sat: 4k/5.5k
  {
    id: "fs-veggie-line",
    site: "F&S Fresh Foods",
    lineName: "Veggie Line",
    operatingHours: "Mon-Sat · 3:00am-2:00pm",
    defaultRobotByDow: MS(5000, 4000),
    defaultTotalByDow: MS(7000, 5500),
  },
  {
    id: "fs-usda-line",
    site: "F&S Fresh Foods",
    lineName: "USDA Line",
    operatingHours: "Mon-Sat · 3:00am-2:00pm",
    defaultRobotByDow: MS(5000, 4000),
    defaultTotalByDow: MS(7000, 5500),
  },

  // Taylor Farms — 2 lines · Mon-Sat · 6:00am-1:00am
  // Mon-Fri: 4k/6k · Sat: 3k/4.5k
  {
    id: "taylor-farms-line-31",
    site: "Taylor Farms",
    lineName: "Line 31",
    operatingHours: "Mon-Sat · 6:00am-1:00am",
    defaultRobotByDow: MS(4000, 3000),
    defaultTotalByDow: MS(6000, 4500),
  },
  {
    id: "taylor-farms-line-33",
    site: "Taylor Farms",
    lineName: "Line 33",
    operatingHours: "Mon-Sat · 6:00am-1:00am",
    defaultRobotByDow: MS(4000, 3000),
    defaultTotalByDow: MS(6000, 4500),
  },

  // Bonduelle — 2 lines · Mon-Sat · 6:30am-2:30pm
  // Mon-Fri: 2k/3k · Sat: 1.5k/2.2k
  {
    id: "bonduelle-line-1",
    site: "Bonduelle",
    lineName: "Line 1",
    operatingHours: "Mon-Sat · 6:30am-2:30pm",
    defaultRobotByDow: MS(2000, 1500),
    defaultTotalByDow: MS(3000, 2200),
  },
  {
    id: "bonduelle-line-2",
    site: "Bonduelle",
    lineName: "Line 2",
    operatingHours: "Mon-Sat · 6:30am-2:30pm",
    defaultRobotByDow: MS(2000, 1500),
    defaultTotalByDow: MS(3000, 2200),
  },

  // POH — 1 line · Mon-Fri · 7:00am-3:00pm · 1.5k/2k
  {
    id: "poh-line-1",
    site: "POH",
    lineName: "Line 1",
    operatingHours: "Mon-Fri · 7:00am-3:00pm",
    defaultRobotByDow: MF(1500),
    defaultTotalByDow: MF(2000),
  },

  // CookUnity LAX — 2 lines · Mon-Fri · 6:30am-9:30pm · 2.5k/3.5k
  {
    id: "cookunity-lax-line-1",
    site: "CookUnity LAX",
    lineName: "Line 1",
    operatingHours: "Mon-Fri · 6:30am-9:30pm",
    defaultRobotByDow: MF(2500),
    defaultTotalByDow: MF(3500),
  },
  {
    id: "cookunity-lax-line-2",
    site: "CookUnity LAX",
    lineName: "Line 2",
    operatingHours: "Mon-Fri · 6:30am-9:30pm",
    defaultRobotByDow: MF(2500),
    defaultTotalByDow: MF(3500),
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
