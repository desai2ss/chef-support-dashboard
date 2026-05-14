import { Pool } from "@neondatabase/serverless";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const body = readFileSync(join(dir, f), "utf8");
    // eslint-disable-next-line no-console
    console.log(`Applying ${f}…`);
    // neon Pool supports multi-statement strings directly.
    await pool.query(body);
  }
  await pool.end();
  // eslint-disable-next-line no-console
  console.log("Migrations applied.");
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
