// Seeds the customers list with Chef Robotics' current production accounts.
// Idempotent: re-running won't duplicate rows (uses ON CONFLICT DO NOTHING via the unique name).
//
// Usage:
//   DATABASE_URL=postgresql://… npx tsx scripts/seed.ts

import { Pool } from "@neondatabase/serverless";

const SEED_CUSTOMERS: { name: string; weeklyHoursExpected: number }[] = [
  { name: "Amy's Medford",   weeklyHoursExpected: 0 },
  { name: "Amy's Pocatello", weeklyHoursExpected: 0 },
  { name: "Bonduelle",       weeklyHoursExpected: 0 },
  { name: "Cafe Spice",      weeklyHoursExpected: 0 },
  { name: "Chef Bombay",     weeklyHoursExpected: 0 },
  { name: "F&S Foods",       weeklyHoursExpected: 0 },
  { name: "Cookunity",       weeklyHoursExpected: 0 },
  { name: "POH",             weeklyHoursExpected: 0 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  for (const c of SEED_CUSTOMERS) {
    await pool.query(
      `INSERT INTO customers (name, weekly_hours_expected)
       VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [c.name, c.weeklyHoursExpected]
    );
    // eslint-disable-next-line no-console
    console.log(`  ok  ${c.name}`);
  }
  await pool.end();
  // eslint-disable-next-line no-console
  console.log(`Seeded ${SEED_CUSTOMERS.length} customers.`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
