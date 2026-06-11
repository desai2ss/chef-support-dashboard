import { pgTable, uuid, text, integer, real, timestamp, jsonb, pgEnum, primaryKey } from "drizzle-orm/pg-core";

export const moduleStatus = pgEnum("module_status", [
  "on-track",
  "at-risk",
  "blocked",
  "down",
]);

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  weeklyHoursExpected: integer("weekly_hours_expected").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const modules = pgTable("modules", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: moduleStatus("status").notNull().default("on-track"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyNotes = pgTable("daily_notes", {
  // one row per day; primary key on date keeps it simple
  date: text("date").primaryKey(), // YYYY-MM-DD
  knownDownText: text("known_down_text").notNull().default(""),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),    // e.g. "customer.update"
  entity: text("entity").notNull(),    // e.g. "customer:<uuid>"
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-cell schedule overrides. One row per (line_id, date). Defaults from
// schedules-config.ts apply for any cell without a row here.
export const scheduleOverrides = pgTable(
  "schedule_overrides",
  {
    lineId: text("line_id").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    robot: integer("robot"),
    total: integer("total"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.lineId, t.date] }),
  })
);

// Daily metrics — one row per (sn, date). `util_pct` and `servings` are
// auto-populated by the BigQuery rollup (lib/metrics-rollup.ts). `uptime_pct`
// defaults to 100 and only changes via the Metrics tab's downtime editor,
// which requires a linked Pylon ticket to justify the change.
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    sn: integer("sn").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    site: text("site").notNull(),
    // From BigQuery sessions_v0 rollup. Null = no production data that day.
    utilPct: real("util_pct"), // 0..200 (can exceed 100 for overtime)
    productionHours: real("production_hours"), // 0..24+
    servings: integer("servings"), // null until source is wired up
    // Manual entries. Default = 100 (full uptime). Editor lowers via downtime modal.
    uptimePct: real("uptime_pct").notNull().default(100),
    uptimePylonTicket: text("uptime_pylon_ticket"),
    uptimeNote: text("uptime_note"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sn, t.date] }),
  })
);

// Team calendar entries — one row per (team-member, date). Shared across
// everyone logged in (replaces the old localStorage-only calendar). The
// Team tab navigates one week at a time via ‹ › buttons; entries are kept
// indefinitely so you can scroll back to past weeks too.
export const teamCalendar = pgTable(
  "team_calendar",
  {
    memberId: text("member_id").notNull(), // matches TeamMember.id in lib/team-config.ts
    date: text("date").notNull(), // YYYY-MM-DD
    note: text("note").notNull().default(""),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.memberId, t.date] }),
  })
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Module = typeof modules.$inferSelect;
export type NewModule = typeof modules.$inferInsert;
export type DailyNote = typeof dailyNotes.$inferSelect;
export type ScheduleOverride = typeof scheduleOverrides.$inferSelect;
export type NewScheduleOverride = typeof scheduleOverrides.$inferInsert;
export type TeamCalendarEntry = typeof teamCalendar.$inferSelect;
export type NewTeamCalendarEntry = typeof teamCalendar.$inferInsert;
export type DailyMetricsRow = typeof dailyMetrics.$inferSelect;
export type NewDailyMetricsRow = typeof dailyMetrics.$inferInsert;
