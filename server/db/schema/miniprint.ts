import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AttachmentMeta,
  EvaluationFacts,
  TradeLine,
  TradeRecommendation,
} from "../../../shared/miniprint/types";
import type { TierConfig } from "../../../shared/miniprint/tiers";
import { user } from "./auth";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const ownerId = () => text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true })
  .defaultNow()
  .$onUpdate(() => new Date())
  .notNull();

// ---------------------------------------------------------------------------
// MiniPrint.io catalog — public data, shared across owners. Every value here
// was read from a miniprint.io page; nothing is filled in from model output.
// ---------------------------------------------------------------------------

export const catalogPrints = pgTable("mp_catalog_prints", {
  /** `mp-<miniprint id>` — stable across renames on miniprint.io. */
  printId: text("print_id").primaryKey(),
  miniprintId: integer("miniprint_id").notNull(),
  canonicalName: text("canonical_name").notNull(),
  artist: text("artist").notNull(),
  artistSlug: text("artist_slug").notNull(),
  slug: text("slug").notNull(),
  /** Raw rarity value as published (`common`, `limited`, `unicorn`, `ooc`, …), or null when absent. */
  rarity: text("rarity"),
  circulationStatus: text("circulation_status").notNull().default("unknown"),
  collection: text("collection"),
  catalogUrl: text("catalog_url").notNull(),
  imageUrl: text("image_url"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verificationStatus: text("verification_status").notNull().default("unverified"),
  /** The miniprint.io build that served the verified values. */
  sourceBuildId: text("source_build_id"),
  /** Exact source fields captured at verification, for audit. */
  sourceSnapshot: jsonb("source_snapshot").$type<Record<string, unknown>>(),
  firstSeenAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  uniqueIndex("mp_catalog_miniprint_id_idx").on(table.miniprintId),
  uniqueIndex("mp_catalog_url_idx").on(table.catalogUrl),
  index("mp_catalog_artist_idx").on(table.artistSlug),
]);

export const catalogSyncRuns = pgTable("mp_catalog_sync_runs", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  pagesFetched: integer("pages_fetched").notNull().default(0),
  printsUpserted: integer("prints_upserted").notNull().default(0),
  printsMissing: integer("prints_missing").notNull().default(0),
  sourceBuildId: text("source_build_id"),
  errors: jsonb("errors").$type<string[]>().notNull().default([]),
});

// ---------------------------------------------------------------------------
// Inventory — built from the owner's uploaded trade-post photographs.
// ---------------------------------------------------------------------------

export const inventoryUploads = pgTable("mp_inventory_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  modelId: text("model_id"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, table => [
  uniqueIndex("mp_uploads_owner_sha_idx").on(table.ownerId, table.sha256),
]);

/** Image bytes kept apart from the upload row so listings never load them. */
export const inventoryImages = pgTable("mp_inventory_images", {
  uploadId: uuid("upload_id").primaryKey().references(() => inventoryUploads.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
});

export const inventoryDetections = pgTable("mp_inventory_detections", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  uploadId: uuid("upload_id").notNull().references(() => inventoryUploads.id, { onDelete: "cascade" }),
  detectionIndex: integer("detection_index").notNull(),
  /** Text the model read on the print, if any. Untrusted. */
  observedText: text("observed_text"),
  visualDescription: text("visual_description").notNull(),
  locationHint: text("location_hint"),
  candidates: jsonb("candidates").$type<Array<{ printId: string; reason: string; visualCheck?: string }>>().notNull().default([]),
  matchedPrintId: text("matched_print_id").references(() => catalogPrints.printId, { onDelete: "set null" }),
  matchConfidence: text("match_confidence").notNull().default("none"),
  matchMethod: text("match_method"),
  /** Copies of this print visible in this one photograph, when the model could count them. */
  visibleCount: integer("visible_count"),
  countCertain: boolean("count_certain").notNull().default(false),
  reviewStatus: text("review_status").notNull().default("needs_review"),
  reviewNotes: text("review_notes"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, table => [
  uniqueIndex("mp_detections_upload_idx").on(table.uploadId, table.detectionIndex),
  index("mp_detections_owner_review_idx").on(table.ownerId, table.reviewStatus),
]);

export const inventoryItems = pgTable("mp_inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  printId: text("print_id").notNull().references(() => catalogPrints.printId),
  /** Null when the photos do not establish a count. */
  quantity: integer("quantity"),
  quantityBasis: text("quantity_basis").notNull().default("unknown"),
  availability: text("availability").notNull().default("available"),
  source: text("source").notNull().default("photo"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  uniqueIndex("mp_inventory_owner_print_idx").on(table.ownerId, table.printId),
]);

// ---------------------------------------------------------------------------
// Messenger data.
// ---------------------------------------------------------------------------

export const ownerSettings = pgTable("mp_owner_settings", {
  ownerId: text("owner_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  /** Display names the owner appears under in Messenger exports. */
  messengerNames: jsonb("messenger_names").$type<string[]>().notNull().default([]),
  /** Owner's own difficulty ordering of rarities; null uses DEFAULT_TIER_CONFIG. */
  tierConfig: jsonb("tier_config").$type<TierConfig>(),
  updatedAt: updatedAt(),
});

export const collectors = pgTable("mp_collectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  displayName: text("display_name").notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  uniqueIndex("mp_collectors_owner_name_idx").on(table.ownerId, table.displayName),
]);

export const collectorPreferences = pgTable("mp_collector_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  collectorId: uuid("collector_id").notNull().references(() => collectors.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  printId: text("print_id").references(() => catalogPrints.printId, { onDelete: "set null" }),
  printLabel: text("print_label"),
  /** The collector's own words, verified to appear in the source message. */
  quote: text("quote").notNull(),
  sourceMessageId: uuid("source_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, table => [
  index("mp_prefs_collector_idx").on(table.collectorId),
  uniqueIndex("mp_prefs_dedupe_idx").on(table.sourceMessageId, table.kind, table.quote),
]);

export const conversations = pgTable("mp_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  /** Stable key derived from the source (e.g. the export's thread path). */
  sourceKey: text("source_key").notNull(),
  title: text("title"),
  participants: jsonb("participants").$type<string[]>().notNull().default([]),
  isGroup: boolean("is_group").notNull().default(false),
  /** The other party in a one-to-one thread. */
  collectorId: uuid("collector_id").references(() => collectors.id, { onDelete: "set null" }),
  /** Last message whose analysis finished; analysis resumes after it. */
  analyzedThrough: timestamp("analyzed_through", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  uniqueIndex("mp_conversations_owner_key_idx").on(table.ownerId, table.sourceKey),
]);

export const importBatches = pgTable("mp_import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  source: text("source").notNull(),
  label: text("label"),
  status: text("status").notNull().default("receiving"),
  messagesReceived: integer("messages_received").notNull().default(0),
  messagesInserted: integer("messages_inserted").notNull().default(0),
  duplicatesSkipped: integer("duplicates_skipped").notNull().default(0),
  earliestMessageAt: timestamp("earliest_message_at", { withTimezone: true }),
  latestMessageAt: timestamp("latest_message_at", { withTimezone: true }),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const messages = pgTable("mp_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  /** Provider message id. Facebook data exports do not include one. */
  sourceMessageId: text("source_message_id"),
  /**
   * Dedupe key: conversation, sender, millisecond timestamp, content hash,
   * attachment URIs and an ordinal among otherwise identical events.
   */
  fingerprint: text("fingerprint").notNull(),
  senderName: text("sender_name").notNull(),
  senderIsOwner: boolean("sender_is_owner").notNull().default(false),
  collectorId: uuid("collector_id").references(() => collectors.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
  text: text("text"),
  attachments: jsonb("attachments").$type<AttachmentMeta[]>().notNull().default([]),
  reactions: jsonb("reactions").$type<Array<{ actor: string; reaction: string }>>().notNull().default([]),
  isUnsent: boolean("is_unsent").notNull().default(false),
  ingestionSource: text("ingestion_source").notNull(),
  importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
  processingStatus: text("processing_status").notNull().default("pending"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  search: tsvector("search").generatedAlwaysAs(sql`to_tsvector('simple', coalesce("text", ''))`),
  createdAt: createdAt(),
}, table => [
  uniqueIndex("mp_messages_owner_fingerprint_idx").on(table.ownerId, table.fingerprint),
  uniqueIndex("mp_messages_owner_source_id_idx")
    .on(table.ownerId, table.ingestionSource, table.sourceMessageId)
    .where(sql`${table.sourceMessageId} is not null`),
  index("mp_messages_conversation_time_idx").on(table.conversationId, table.timestampMs),
  index("mp_messages_status_idx").on(table.ownerId, table.processingStatus),
  index("mp_messages_search_idx").using("gin", table.search),
]);

export const ingestionGaps = pgTable("mp_ingestion_gaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  description: text("description").notNull(),
  gapStart: timestamp("gap_start", { withTimezone: true }),
  gapEnd: timestamp("gap_end", { withTimezone: true }),
  importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
}, table => [
  index("mp_gaps_owner_idx").on(table.ownerId, table.resolvedAt),
]);

// ---------------------------------------------------------------------------
// Trade ledger.
// ---------------------------------------------------------------------------

export const trades = pgTable("mp_trades", {
  tradeId: uuid("trade_id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  collectorId: uuid("collector_id").references(() => collectors.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  sourceMessageIds: jsonb("source_message_ids").$type<string[]>().notNull().default([]),
  /** Prints the collector wants from the owner. */
  printsRequested: jsonb("prints_requested").$type<TradeLine[]>().notNull().default([]),
  /** Prints the collector would give the owner. */
  printsOffered: jsonb("prints_offered").$type<TradeLine[]>().notNull().default([]),
  tradeStatus: text("trade_status").notNull().default("new_offer"),
  /** Who set the current status: `ai_interpretation` or `owner_confirmed`. */
  statusSource: text("status_source").notNull().default("ai_interpretation"),
  /** A terminal status the messages suggest but the owner has not confirmed. */
  proposedStatus: text("proposed_status"),
  proposedStatusMessageIds: jsonb("proposed_status_message_ids").$type<string[]>().notNull().default([]),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull(),
  rarityVerificationStatus: text("rarity_verification_status").notNull().default("not_checked"),
  inventoryMatchStatus: text("inventory_match_status").notNull().default("not_checked"),
  recommendation: jsonb("recommendation").$type<TradeRecommendation>(),
  decisionNotes: text("decision_notes"),
  currentRevision: integer("current_revision").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  index("mp_trades_owner_status_idx").on(table.ownerId, table.tradeStatus),
  index("mp_trades_collector_idx").on(table.collectorId),
  index("mp_trades_conversation_idx").on(table.conversationId),
]);

/** Append-only history: every change to a trade adds a row; nothing is overwritten. */
export const tradeRevisions = pgTable("mp_trade_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradeId: uuid("trade_id").notNull().references(() => trades.tradeId, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  kind: text("kind").notNull(),
  tradeStatus: text("trade_status").notNull(),
  printsRequested: jsonb("prints_requested").$type<TradeLine[]>().notNull(),
  printsOffered: jsonb("prints_offered").$type<TradeLine[]>().notNull(),
  sourceMessageIds: jsonb("source_message_ids").$type<string[]>().notNull().default([]),
  /** `collector`, `owner`, or `unknown` — whose message prompted the change. */
  actor: text("actor").notNull().default("unknown"),
  /** `ai` for extracted events, `owner` for dashboard / approved changes. */
  recordedBy: text("recorded_by").notNull(),
  interpretation: text("interpretation"),
  confidence: text("confidence"),
  /** Message excerpt the event was based on, verified against the message text. */
  quote: text("quote"),
  quoteVerified: boolean("quote_verified").notNull().default(false),
  /** Idempotency key for AI-extracted events so retries cannot double-apply. */
  eventKey: text("event_key"),
  createdAt: createdAt(),
}, table => [
  uniqueIndex("mp_revisions_trade_rev_idx").on(table.tradeId, table.revision),
  uniqueIndex("mp_revisions_event_key_idx").on(table.eventKey),
]);

export const tradeEvaluations = pgTable("mp_trade_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  tradeId: uuid("trade_id").notNull().references(() => trades.tradeId, { onDelete: "cascade" }),
  tradeRevision: integer("trade_revision").notNull(),
  recommendation: text("recommendation").notNull(),
  summary: text("summary").notNull(),
  facts: jsonb("facts").$type<EvaluationFacts>().notNull(),
  createdAt: createdAt(),
}, table => [
  index("mp_evaluations_trade_idx").on(table.tradeId, table.createdAt),
]);

/**
 * Links a trade, revision, evaluation, detection or preference to the record
 * that supports it, labelled with what kind of evidence it is.
 */
export const evidenceRefs = pgTable("mp_evidence_refs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: ownerId(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  evidenceType: text("evidence_type").notNull(),
  refId: text("ref_id").notNull(),
  category: text("category").notNull(),
  note: text("note"),
  createdAt: createdAt(),
}, table => [
  index("mp_evidence_subject_idx").on(table.subjectType, table.subjectId),
  index("mp_evidence_ref_idx").on(table.evidenceType, table.refId),
]);

// ---------------------------------------------------------------------------
// Durable background jobs.
// ---------------------------------------------------------------------------

export const analysisJobs = pgTable("mp_analysis_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastError: text("last_error"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, table => [
  uniqueIndex("mp_jobs_idempotency_idx").on(table.idempotencyKey),
  index("mp_jobs_due_idx").on(table.status, table.runAfter),
]);
