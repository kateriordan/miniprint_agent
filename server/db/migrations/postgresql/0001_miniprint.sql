CREATE TABLE "mp_analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mp_catalog_prints" (
	"print_id" text PRIMARY KEY NOT NULL,
	"miniprint_id" integer NOT NULL,
	"canonical_name" text NOT NULL,
	"artist" text NOT NULL,
	"artist_slug" text NOT NULL,
	"slug" text NOT NULL,
	"rarity" text,
	"circulation_status" text DEFAULT 'unknown' NOT NULL,
	"collection" text,
	"catalog_url" text NOT NULL,
	"image_url" text,
	"verified_at" timestamp with time zone,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"source_build_id" text,
	"source_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_catalog_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"prints_upserted" integer DEFAULT 0 NOT NULL,
	"prints_missing" integer DEFAULT 0 NOT NULL,
	"source_build_id" text,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_collector_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"collector_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"print_id" text,
	"print_label" text,
	"quote" text NOT NULL,
	"source_message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_collectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"display_name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"source_key" text NOT NULL,
	"title" text,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"collector_id" uuid,
	"analyzed_through" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_evidence_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"evidence_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"category" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"source" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'receiving' NOT NULL,
	"messages_received" integer DEFAULT 0 NOT NULL,
	"messages_inserted" integer DEFAULT 0 NOT NULL,
	"duplicates_skipped" integer DEFAULT 0 NOT NULL,
	"earliest_message_at" timestamp with time zone,
	"latest_message_at" timestamp with time zone,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mp_ingestion_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" uuid,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"gap_start" timestamp with time zone,
	"gap_end" timestamp with time zone,
	"import_batch_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_inventory_detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"upload_id" uuid NOT NULL,
	"detection_index" integer NOT NULL,
	"observed_text" text,
	"visual_description" text NOT NULL,
	"location_hint" text,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_print_id" text,
	"match_confidence" text DEFAULT 'none' NOT NULL,
	"match_method" text,
	"visible_count" integer,
	"count_certain" boolean DEFAULT false NOT NULL,
	"review_status" text DEFAULT 'needs_review' NOT NULL,
	"review_notes" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_inventory_images" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"print_id" text NOT NULL,
	"quantity" integer,
	"quantity_basis" text DEFAULT 'unknown' NOT NULL,
	"availability" text DEFAULT 'available' NOT NULL,
	"source" text DEFAULT 'photo' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_inventory_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"model_id" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_message_id" text,
	"fingerprint" text NOT NULL,
	"sender_name" text NOT NULL,
	"sender_is_owner" boolean DEFAULT false NOT NULL,
	"collector_id" uuid,
	"sent_at" timestamp with time zone NOT NULL,
	"timestamp_ms" bigint NOT NULL,
	"text" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reactions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_unsent" boolean DEFAULT false NOT NULL,
	"ingestion_source" text NOT NULL,
	"import_batch_id" uuid,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("text", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_owner_settings" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"messenger_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tier_config" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_trade_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"trade_id" uuid NOT NULL,
	"trade_revision" integer NOT NULL,
	"recommendation" text NOT NULL,
	"summary" text NOT NULL,
	"facts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_trade_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"trade_status" text NOT NULL,
	"prints_requested" jsonb NOT NULL,
	"prints_offered" jsonb NOT NULL,
	"source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor" text DEFAULT 'unknown' NOT NULL,
	"recorded_by" text NOT NULL,
	"interpretation" text,
	"confidence" text,
	"quote" text,
	"quote_verified" boolean DEFAULT false NOT NULL,
	"event_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_trades" (
	"trade_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"collector_id" uuid,
	"conversation_id" uuid NOT NULL,
	"source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prints_requested" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prints_offered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trade_status" text DEFAULT 'new_offer' NOT NULL,
	"status_source" text DEFAULT 'ai_interpretation' NOT NULL,
	"proposed_status" text,
	"proposed_status_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_updated_at" timestamp with time zone NOT NULL,
	"rarity_verification_status" text DEFAULT 'not_checked' NOT NULL,
	"inventory_match_status" text DEFAULT 'not_checked' NOT NULL,
	"recommendation" jsonb,
	"decision_notes" text,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mp_analysis_jobs" ADD CONSTRAINT "mp_analysis_jobs_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_collector_preferences" ADD CONSTRAINT "mp_collector_preferences_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_collector_preferences" ADD CONSTRAINT "mp_collector_preferences_collector_id_mp_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."mp_collectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_collector_preferences" ADD CONSTRAINT "mp_collector_preferences_print_id_mp_catalog_prints_print_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."mp_catalog_prints"("print_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_collector_preferences" ADD CONSTRAINT "mp_collector_preferences_source_message_id_mp_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."mp_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_collectors" ADD CONSTRAINT "mp_collectors_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_conversations" ADD CONSTRAINT "mp_conversations_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_conversations" ADD CONSTRAINT "mp_conversations_collector_id_mp_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."mp_collectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_evidence_refs" ADD CONSTRAINT "mp_evidence_refs_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_import_batches" ADD CONSTRAINT "mp_import_batches_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_ingestion_gaps" ADD CONSTRAINT "mp_ingestion_gaps_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_ingestion_gaps" ADD CONSTRAINT "mp_ingestion_gaps_conversation_id_mp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."mp_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_ingestion_gaps" ADD CONSTRAINT "mp_ingestion_gaps_import_batch_id_mp_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."mp_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_inventory_detections" ADD CONSTRAINT "mp_inventory_detections_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_inventory_detections" ADD CONSTRAINT "mp_inventory_detections_upload_id_mp_inventory_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."mp_inventory_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_inventory_detections" ADD CONSTRAINT "mp_inventory_detections_matched_print_id_mp_catalog_prints_print_id_fk" FOREIGN KEY ("matched_print_id") REFERENCES "public"."mp_catalog_prints"("print_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_inventory_images" ADD CONSTRAINT "mp_inventory_images_upload_id_mp_inventory_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."mp_inventory_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_inventory_items" ADD CONSTRAINT "mp_inventory_items_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_inventory_items" ADD CONSTRAINT "mp_inventory_items_print_id_mp_catalog_prints_print_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."mp_catalog_prints"("print_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_inventory_uploads" ADD CONSTRAINT "mp_inventory_uploads_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_messages" ADD CONSTRAINT "mp_messages_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_messages" ADD CONSTRAINT "mp_messages_conversation_id_mp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."mp_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_messages" ADD CONSTRAINT "mp_messages_collector_id_mp_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."mp_collectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_messages" ADD CONSTRAINT "mp_messages_import_batch_id_mp_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."mp_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_owner_settings" ADD CONSTRAINT "mp_owner_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_trade_evaluations" ADD CONSTRAINT "mp_trade_evaluations_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_trade_evaluations" ADD CONSTRAINT "mp_trade_evaluations_trade_id_mp_trades_trade_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."mp_trades"("trade_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_trade_revisions" ADD CONSTRAINT "mp_trade_revisions_trade_id_mp_trades_trade_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."mp_trades"("trade_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_trades" ADD CONSTRAINT "mp_trades_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_trades" ADD CONSTRAINT "mp_trades_collector_id_mp_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."mp_collectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_trades" ADD CONSTRAINT "mp_trades_conversation_id_mp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."mp_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mp_jobs_idempotency_idx" ON "mp_analysis_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "mp_jobs_due_idx" ON "mp_analysis_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_catalog_miniprint_id_idx" ON "mp_catalog_prints" USING btree ("miniprint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_catalog_url_idx" ON "mp_catalog_prints" USING btree ("catalog_url");--> statement-breakpoint
CREATE INDEX "mp_catalog_artist_idx" ON "mp_catalog_prints" USING btree ("artist_slug");--> statement-breakpoint
CREATE INDEX "mp_prefs_collector_idx" ON "mp_collector_preferences" USING btree ("collector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_prefs_dedupe_idx" ON "mp_collector_preferences" USING btree ("source_message_id","kind","quote");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_collectors_owner_name_idx" ON "mp_collectors" USING btree ("owner_id","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_conversations_owner_key_idx" ON "mp_conversations" USING btree ("owner_id","source_key");--> statement-breakpoint
CREATE INDEX "mp_evidence_subject_idx" ON "mp_evidence_refs" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "mp_evidence_ref_idx" ON "mp_evidence_refs" USING btree ("evidence_type","ref_id");--> statement-breakpoint
CREATE INDEX "mp_gaps_owner_idx" ON "mp_ingestion_gaps" USING btree ("owner_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_detections_upload_idx" ON "mp_inventory_detections" USING btree ("upload_id","detection_index");--> statement-breakpoint
CREATE INDEX "mp_detections_owner_review_idx" ON "mp_inventory_detections" USING btree ("owner_id","review_status");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_inventory_owner_print_idx" ON "mp_inventory_items" USING btree ("owner_id","print_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_uploads_owner_sha_idx" ON "mp_inventory_uploads" USING btree ("owner_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_messages_owner_fingerprint_idx" ON "mp_messages" USING btree ("owner_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_messages_owner_source_id_idx" ON "mp_messages" USING btree ("owner_id","ingestion_source","source_message_id") WHERE "mp_messages"."source_message_id" is not null;--> statement-breakpoint
CREATE INDEX "mp_messages_conversation_time_idx" ON "mp_messages" USING btree ("conversation_id","timestamp_ms");--> statement-breakpoint
CREATE INDEX "mp_messages_status_idx" ON "mp_messages" USING btree ("owner_id","processing_status");--> statement-breakpoint
CREATE INDEX "mp_messages_search_idx" ON "mp_messages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "mp_evaluations_trade_idx" ON "mp_trade_evaluations" USING btree ("trade_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_revisions_trade_rev_idx" ON "mp_trade_revisions" USING btree ("trade_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_revisions_event_key_idx" ON "mp_trade_revisions" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "mp_trades_owner_status_idx" ON "mp_trades" USING btree ("owner_id","trade_status");--> statement-breakpoint
CREATE INDEX "mp_trades_collector_idx" ON "mp_trades" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "mp_trades_conversation_idx" ON "mp_trades" USING btree ("conversation_id");