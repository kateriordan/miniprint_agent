-- Supabase exposes the public schema through its Data API (PostgREST) to the
-- anon and authenticated roles. This app never uses that API: it connects as
-- the table owner, which bypasses RLS. Enabling RLS with no policies makes
-- these tables unreachable through the Data API. Add new tables here.
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_analysis_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_catalog_prints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_catalog_sync_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_collector_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_collectors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_evidence_refs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_ingestion_gaps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_inventory_detections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_inventory_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_inventory_uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_owner_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_trade_evaluations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_trade_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phone_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slack_link_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slack_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_hub_migrations" ENABLE ROW LEVEL SECURITY;
