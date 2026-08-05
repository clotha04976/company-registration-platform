import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const cases = sqliteTable("cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyName: text("company_name").notNull(),
  summary: text("summary").notNull(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id),
  status: text("status", { enum: ["ongoing", "completed"] })
    .notNull()
    .default("ongoing"),
  stage: text("stage", {
    enum: ["name_precheck", "city_government", "national_tax", "completed"],
  })
    .notNull()
    .default("name_precheck"),
  progress: integer("progress").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
  bonusTwd: integer("bonus_twd").notNull().default(500),
  createdAt: text("created_at").notNull(),
});

export const caseApprovalDocuments = sqliteTable(
  "case_approval_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    caseId: integer("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    agency: text("agency", {
      enum: ["city_government", "national_tax"],
    }).notNull(),
    status: text("status", { enum: ["not_received", "received", "archived"] })
      .notNull()
      .default("not_received"),
    approvalDate: text("approval_date"),
    documentNumber: text("document_number"),
    cloudPath: text("cloud_path"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("case_approval_documents_case_agency_unique").on(
      table.caseId,
      table.agency,
    ),
    index("case_approval_documents_case_status_idx").on(
      table.caseId,
      table.status,
    ),
  ],
);

export const registrationCardTracking = sqliteTable(
  "registration_card_tracking",
  {
    caseId: integer("case_id")
      .primaryKey()
      .references(() => cases.id, { onDelete: "cascade" }),
    originalReceived: integer("original_received", { mode: "boolean" })
      .notNull()
      .default(false),
    customerCopySent: integer("customer_copy_sent", { mode: "boolean" })
      .notNull()
      .default(false),
    updatedAt: text("updated_at").notNull(),
  },
);
