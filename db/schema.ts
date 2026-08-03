import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const cases = sqliteTable("cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyName: text("company_name").notNull(),
  summary: text("summary").notNull(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  status: text("status", { enum: ["ongoing", "completed"] }).notNull().default("ongoing"),
  stage: text("stage", { enum: ["name_precheck", "city_government", "national_tax", "completed"] }).notNull().default("name_precheck"),
  progress: integer("progress").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
  bonusTwd: integer("bonus_twd").notNull().default(500),
  createdAt: text("created_at").notNull(),
});
