import { sqliteTable, text, real, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  wechatUserId: text("wechat_user_id").unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("member"),
  relationship: text("relationship"),
  birthDate: text("birth_date"),
  incomeRole: text("income_role"),
  isFinancialDependent: integer("is_financial_dependent", { mode: "boolean" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  mergedIntoMemberId: text("merged_into_member_id"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  icon: text("icon"),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  icon: text("icon"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    amount: real("amount").notNull(),
    description: text("description").notNull(),
    categoryId: text("category_id").notNull().references(() => categories.id),
    accountId: text("account_id").references(() => accounts.id),
    memberId: text("member_id").notNull().references(() => members.id),
    transactionDate: text("transaction_date").notNull(),
    note: text("note"),
    source: text("source").notNull().default("admin"),
    aiRawInput: text("ai_raw_input"),
    aiConfidence: real("ai_confidence"),
    annualProjectId: text("annual_project_id").references(() => annualProjects.id),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_transactions_date").on(table.transactionDate),
    index("idx_transactions_type").on(table.type),
    index("idx_transactions_member").on(table.memberId),
    index("idx_transactions_category").on(table.categoryId),
  ]
);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("CNY"),
  allocationBucket: text("allocation_bucket").notNull().default("stable"),
  liquidity: text("liquidity").notNull().default("short_term"),
  rebalanceMode: text("rebalance_mode").notNull().default("flexible"),
  purpose: text("purpose").notNull().default("other"),
  accountInfo: text("account_info"),
  costBasis: real("cost_basis"),
  sortOrder: integer("sort_order").notNull().default(0),
  frequency: text("frequency"),
  memberId: text("member_id").references(() => members.id),
  startDate: text("start_date"),
  endDate: text("end_date"),
  note: text("note"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

export const assetValuations = sqliteTable(
  "asset_valuations",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull().references(() => assets.id),
    date: text("date").notNull(),
    value: real("value").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_asset_valuations_asset").on(table.assetId),
    uniqueIndex("idx_asset_valuations_asset_date").on(table.assetId, table.date),
  ]
);

export const financialSnapshots = sqliteTable(
  "financial_snapshots",
  {
    id: text("id").primaryKey(),
    snapshotDate: text("snapshot_date").notNull(),
    totalAssets: real("total_assets").notNull(),
    totalLiabilities: real("total_liabilities").notNull(),
    netWorth: real("net_worth").notNull(),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (table) => [uniqueIndex("idx_financial_snapshots_date").on(table.snapshotDate)]
);

export const financialDiagnosisAnalyses = sqliteTable(
  "financial_diagnosis_analyses",
  {
    id: text("id").primaryKey(),
    asOfDate: text("as_of_date").notNull(),
    analysis: text("analysis").notNull(),
    snapshot: text("snapshot").notNull(),
    generatedAt: text("generated_at").notNull(),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (table) => [uniqueIndex("idx_financial_diagnosis_analyses_date").on(table.asOfDate)]
);

export const liabilities = sqliteTable("liabilities", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  balance: real("balance").notNull(),
  originalAmount: real("original_amount"),
  interestRate: real("interest_rate"),
  monthlyPayment: real("monthly_payment"),
  memberId: text("member_id").references(() => members.id),
  linkedAssetId: text("linked_asset_id"),
  note: text("note"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

export const insurancePolicies = sqliteTable("insurance_policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  insuredMemberId: text("insured_member_id").references(() => members.id),
  policyholderMemberId: text("policyholder_member_id").references(() => members.id),
  policyNumber: text("policy_number"),
  insurer: text("insurer"),
  coverageAmount: real("coverage_amount"),
  premium: real("premium"),
  premiumFrequency: text("premium_frequency"),
  cashValue: real("cash_value"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  coverageSummary: text("coverage_summary"),
  coverageTerm: text("coverage_term"),
  deductible: real("deductible"),
  reimbursementRatio: real("reimbursement_ratio"),
  waitingPeriodDays: integer("waiting_period_days"),
  renewalType: text("renewal_type"),
  renewalUntilAge: integer("renewal_until_age"),
  annualLimit: real("annual_limit"),
  beneficiary: text("beneficiary"),
  keyClauses: text("key_clauses"),
  keyExclusions: text("key_exclusions"),
  reviewedAt: text("reviewed_at"),
  claimPhone: text("claim_phone"),
  claimContact: text("claim_contact"),
  claimContactPhone: text("claim_contact_phone"),
  claimChannels: text("claim_channels"),
  claimSteps: text("claim_steps"),
  claimMaterials: text("claim_materials"),
  claimNotes: text("claim_notes"),
  note: text("note"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

export const insuranceAttachments = sqliteTable(
  "insurance_attachments",
  {
    id: text("id").primaryKey(),
    policyId: text("policy_id").notNull().references(() => insurancePolicies.id),
    type: text("type").notNull().default("other"),
    filePath: text("file_path").notNull(),
    originalFileName: text("original_file_name"),
    caption: text("caption"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
  },
  (table) => [index("idx_insurance_attachments_policy").on(table.policyId)]
);

// ---- 家庭预算 ----

export const annualProjects = sqliteTable(
  "annual_projects",
  {
    id: text("id").primaryKey(),
    year: integer("year").notNull(),
    name: text("name").notNull(),
    budgetAmount: real("budget_amount").notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    keywords: text("keywords"),
    note: text("note"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_annual_projects_year").on(table.year),
    uniqueIndex("idx_annual_projects_year_name").on(table.year, table.name),
  ]
);

export const monthlyBudgets = sqliteTable("monthly_budgets", {
  id: text("id").primaryKey(),
  month: text("month").notNull().unique(),
  totalAmount: real("total_amount").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

export const monthlyBudgetItems = sqliteTable(
  "monthly_budget_items",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull().references(() => monthlyBudgets.id),
    categoryId: text("category_id").notNull().references(() => categories.id),
    amount: real("amount").notNull(),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_monthly_budget_items_budget").on(table.budgetId),
    uniqueIndex("idx_monthly_budget_items_budget_category").on(table.budgetId, table.categoryId),
  ]
);

export const annualBudgets = sqliteTable("annual_budgets", {
  id: text("id").primaryKey(),
  year: integer("year").notNull().unique(),
  expectedIncome: real("expected_income").notNull().default(0),
  regularBudgetAmount: real("regular_budget_amount").notNull().default(0),
  note: text("note"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

export const annualBudgetItems = sqliteTable(
  "annual_budget_items",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull().references(() => annualBudgets.id),
    categoryId: text("category_id").notNull().references(() => categories.id),
    amount: real("amount").notNull(),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_annual_budget_items_budget").on(table.budgetId),
    uniqueIndex("idx_annual_budget_items_budget_category").on(table.budgetId, table.categoryId),
  ]
);

export const pendingProjectConfirmations = sqliteTable(
  "pending_project_confirmations",
  {
    id: text("id").primaryKey(),
    installationId: text("installation_id").notNull(),
    senderId: text("sender_id").notNull(),
    transactionId: text("transaction_id").notNull().references(() => transactions.id),
    candidateProjectIds: text("candidate_project_ids").notNull(),
    expiresAt: text("expires_at").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (table) => [index("idx_pending_project_sender").on(table.installationId, table.senderId)]
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

export const installations = sqliteTable("installations", {
  id: text("id").primaryKey(),
  appToken: text("app_token").notNull(),
  webhookSecret: text("webhook_secret").notNull(),
  botId: text("bot_id").notNull(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ---- 健康管理：体检报告 ----

export const healthCheckups = sqliteTable(
  "health_checkups",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id),
    checkupDate: text("checkup_date").notNull(),
    institution: text("institution"),
    parsedName: text("parsed_name"),
    filePath: text("file_path"),
    originalFileName: text("original_file_name"),
    overallSummary: text("overall_summary"),
    abnormalSummary: text("abnormal_summary"),
    rawText: text("raw_text"),
    status: text("status").notNull().default("pending"),
    aiModel: text("ai_model"),
    parseMessage: text("parse_message"),
    note: text("note"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_health_checkups_member").on(table.memberId),
    index("idx_health_checkups_date").on(table.checkupDate),
  ]
);

export const healthCheckupItems = sqliteTable(
  "health_checkup_items",
  {
    id: text("id").primaryKey(),
    checkupId: text("checkup_id").notNull().references(() => healthCheckups.id),
    groupName: text("group_name"),
    itemName: text("item_name").notNull(),
    result: text("result"),
    unit: text("unit"),
    referenceRange: text("reference_range"),
    flag: text("flag").notNull().default("unknown"),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
  },
  (table) => [index("idx_health_checkup_items_checkup").on(table.checkupId)]
);

// ---- 健康管理：就诊记录 ----

export const medicalVisits = sqliteTable(
  "medical_visits",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id),
    visitDate: text("visit_date").notNull(),
    hospital: text("hospital"),
    department: text("department"),
    chiefComplaint: text("chief_complaint"),
    examinations: text("examinations"),
    diagnosis: text("diagnosis"),
    treatment: text("treatment"),
    followUp: text("follow_up"),
    cost: real("cost"),
    note: text("note"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_medical_visits_member").on(table.memberId),
    index("idx_medical_visits_date").on(table.visitDate),
  ]
);

export const medicalVisitAttachments = sqliteTable(
  "medical_visit_attachments",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id").notNull().references(() => medicalVisits.id),
    type: text("type").notNull().default("other"),
    filePath: text("file_path").notNull(),
    originalFileName: text("original_file_name"),
    ocrText: text("ocr_text"),
    caption: text("caption"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
  },
  (table) => [index("idx_medical_visit_attachments_visit").on(table.visitId)]
);

export const medicalVisitMedications = sqliteTable(
  "medical_visit_medications",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id").notNull().references(() => medicalVisits.id),
    drugName: text("drug_name").notNull(),
    spec: text("spec"),
    dosage: text("dosage"),
    quantity: text("quantity"),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
  },
  (table) => [index("idx_medical_visit_medications_visit").on(table.visitId)]
);

// ---- AI 月度财务分析（持久化） ----

export const financialAnalyses = sqliteTable("financial_analyses", {
  id: text("id").primaryKey(),
  month: text("month").notNull().unique(),
  analysis: text("analysis").notNull(),
  // FinancialAnalysisSnapshot 的 JSON 序列化
  snapshot: text("snapshot").notNull(),
  generatedAt: text("generated_at").notNull(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

export const messageLog = sqliteTable("message_log", {
  id: text("id").primaryKey(),
  installationId: text("installation_id").notNull(),
  traceId: text("trace_id"),
  senderId: text("sender_id"),
  messageType: text("message_type").notNull(),
  rawContent: text("raw_content"),
  parsedResult: text("parsed_result"),
  status: text("status").notNull().default("received"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});
