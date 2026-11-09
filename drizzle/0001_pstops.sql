-- Pstop rollup tables. Also created at runtime by ensurePstopTables() in
-- lib/pstops-rollup.ts, so running this file is optional.
CREATE TABLE IF NOT EXISTS "pstop_sessions_daily" (
  "date" text NOT NULL,
  "sn" integer NOT NULL,
  "site" text NOT NULL,
  "ingredient" text NOT NULL,
  "sessions" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("date", "sn", "ingredient")
);

CREATE TABLE IF NOT EXISTS "pstop_counts_daily" (
  "session_date" text NOT NULL,
  "pstop_date" text NOT NULL,
  "sn" integer NOT NULL,
  "site" text NOT NULL,
  "ingredient" text NOT NULL,
  "pstops" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("session_date", "pstop_date", "sn", "ingredient")
);
