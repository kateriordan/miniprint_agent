# MiniPrint Trade Intelligence

> Back to [README](../README.md) | See also: [Architecture](./ARCHITECTURE.md), [Environment](./ENVIRONMENT.md)

A private agent that tracks miniature art-print trades from the owner's Facebook Messenger conversations, keeps a photo-documented inventory, and evaluates offers against the [MiniPrint.io](https://miniprint.io) catalog.

This page records what was investigated, what is implemented, and what is **not** — so nothing here is mistaken for an integration that doesn't exist.

## Status at a glance

| Capability | Status |
|---|---|
| MiniPrint.io catalog sync + verification | **Implemented and tested** against the live site |
| Photo upload → inventory with review queue | **Implemented**, vision pass **untested** (no AI Gateway key in development) |
| Messenger export import (both Meta downloads) + dedupe | **Implemented and tested** with synthetic exports; not yet tested on a real export |
| Incremental messages | Manual entry and re-importing newer exports. **No live source exists** (see below) |
| AI extraction of offers from messages | **Implemented**, **untested** against a model (no AI Gateway key in development) |
| Trade ledger, revisions, owner-confirmed statuses | **Implemented and tested** (integration tests) |
| Evidence-linked evaluation + recommendations | **Implemented and tested** |
| Dashboard (7 views + import) | **Implemented**, checked in the browser |
| 12 agent tools | **Implemented**, exercised through the internal API |
| Browser-based Messenger collector | **Not implemented** — evaluated and rejected (see below) |

## 1. MiniPrint.io catalog access

**Investigation (2026-10-18):**

- No official or documented API. `/api` and `/api/prints` return 404.
- `robots.txt` is `Allow: /` for all agents. It disallows only literal Next.js route templates (`/prints/[artist]/[slug]`), not real pages.
- The Terms of Use cover accounts, content and membership. They contain no clause on automated reading of public pages.
- Public pages are statically generated, and each embeds its catalog record in the `__NEXT_DATA__` JSON. A print page includes `id`, `title`, `rarity`, `is_ooc`, `collection`, `img_url` and the artist.
- `sitemap.xml` lists every print page (≈1,004 on 2026-10-18).

**What the app does** ([`server/utils/mp/catalog.ts`](../server/utils/mp/catalog.ts)):

- Discovers print URLs from the sitemap and the artist listing pages.
- Fetches each print's own detail page at about 1 request per second, with an identifying User-Agent and no authentication or cookies, and stores exactly what the page says.
- Marks a print `verified` only when its detail page was parsed. Listing pages are used only to discover prints.
- Uses these statuses:

  | Status | Meaning |
  |---|---|
  | `rarity_missing` | The page has no rarity value |
  | `missing_from_source` | The page disappeared, or the sitemap no longer lists it |
  | `conflict` | The URL now points at a different print id |
  | `stale` | Last verified more than 7 days ago |

- Runs a full sync weekly, and on demand from **Catalog**. A full sync takes about 20–25 minutes of job time.
- Re-fetches any print older than 24 hours before a trade evaluation uses it.
- Stores rarity exactly as published. The values seen were `common`, `limited`, `unicorn` and `ooc`; circulation comes from `is_ooc`.

**The owner's tier ordering:** MiniPrint.io publishes no ranking between rarities. The owner's own ordering, stated 2026-10-18, is **common < limited < unicorn = out of circulation**. Any print MiniPrint.io flags out of circulation counts in the top tier. This lives in `mp_owner_settings.tier_config` (default in [`shared/miniprint/tiers.ts`](../shared/miniprint/tiers.ts)) and is always labeled as the owner's ordering, never as a catalog fact or a price.

**Name matching** ([`shared/miniprint/match.ts`](../shared/miniprint/match.ts)):

- **Exact after normalization → `verified`:** case, accents, punctuation, `&`/"and" and a leading "the" are ignored.
- **Small spelling difference, no close rival → `candidate`:** always needs review.
- **Rivals or shared titles → `ambiguous`.**
- **Numbers must match exactly**, so "2024 Champions" never matches "2025 Champ".
- **Similar names are never merged.**

## 2. Messenger access — what is and isn't possible

| Method | Supported by Meta? | Personal inbox? | Used here |
|---|---|---|---|
| **Accounts Center → Export your information** (JSON) | Yes — the owner's own data download | Yes; non-encrypted chats only | **Yes** |
| **Messenger → End-to-end encrypted chats → Message storage → Download secure storage data** | Yes — owner's own download (computer, secure storage must be on) | Encrypted chats | **Yes** |
| Messenger Platform / Conversations API | Yes, for **Pages and business accounts** | **No.** It reads conversations between people and a *Page*, with Page tokens | No |
| Graph API on a personal account | Inbox permissions were removed years ago | No | No |
| Unofficial libraries, private GraphQL endpoints, session-cookie bots | **No** — they rely on private APIs and session credentials | Technically, by impersonating the browser | **No** |
| Browser extension / automation reading messenger.com | **No** — automated collection without permission is against Meta's terms | Partially, and breaks often | **Not implemented** (below) |

Sources: Meta's [Conversations API docs](https://developers.facebook.com/docs/messenger-platform/conversations/) (Page and Instagram professional accounts only) and Meta's [end-to-end encryption announcement](https://about.fb.com/news/2024/03/end-to-end-encryption-on-messenger) (encrypted chats).

**Consequence:** there is no authorized live source for a personal inbox. The app never claims continuous monitoring. **System health** always shows *"No live Messenger source is connected"*, the last successful import, per-source coverage, and known gaps.

### The experimental browser collector — evaluated, not built

- **Terms:** automated collection from messenger.com without Meta's permission is prohibited, and accounts doing it risk being locked.
- **Security:** it would need the owner's logged-in session. The project rules forbid extracting private API credentials or uploading cookies, and anything less (reading the visible DOM) runs a scraper inside a logged-in personal account.
- **Feasibility:** the DOM is obfuscated and virtualized, and changes often. Encrypted chats render client-side, so capture would be partial and impossible to verify as complete.

**Conclusion:** not worth the account and security risk. The supported path is periodic exports plus manual entry for urgent new messages.

### Import pipeline

1. **In the browser** ([`app/utils/messenger-import.ts`](../app/utils/messenger-import.ts)), the export `.zip` is streamed and only message JSON entries are decompressed. Photos and videos are never read or uploaded.
2. [`shared/messenger/parse.ts`](../shared/messenger/parse.ts) normalizes both formats:
   - fixes Facebook's mojibake (UTF-8 bytes written as `\u00XX`);
   - merges `message_N.json` parts;
   - keeps attachment metadata (type and file name) only.
3. Chunks go to `/api/mp/imports/:id/conversations`, validated with zod.
4. **Dedupe:** exports carry no message id, so each message is fingerprinted from conversation key, sender, millisecond timestamp, content hash, attachment URIs, and its **ordinal among identical events** — never from text alone. Overlapping imports skip duplicates; two real "yes" messages sent in the same millisecond stay distinct.
5. On completion the app records gaps. A gap is logged when a conversation's new data starts more than a day after the previous data ends with no overlap, and when encrypted chats haven't been imported. It then queues incremental analysis per conversation.

> The encrypted-chat parser follows the documented camelCase shape (`senderName`, `timestamp`, `text`, `media`) and is tolerant of variants. It has **not** yet been run on a real secure-storage download. Import one and check the warnings on **System health**.

## 3. Message analysis

[`server/utils/mp/analysis.ts`](../server/utils/mp/analysis.ts):

- **Batching:** takes the next 60 unprocessed messages of one conversation, plus 25 earlier messages as context and the conversation's open trades. The model never sees the whole archive.
- **Prompt:** message text is wrapped in delimited `<data>` blocks with rules that it is untrusted.
- **Checks in code**, before anything touches the ledger:
  - cited message refs must come from the batch (or its context);
  - the quoted excerpt must appear in a cited message — otherwise confidence drops to *low* and the event is shown as unverified;
  - print names go through the catalog matcher;
  - preferences are kept only when they are an explicit, verifiable collector statement.
- **Status rules:** AI may set `new_offer`, `counteroffer`, `needs_clarification`, `under_review` and `unknown`. When messages suggest *accepted / completed / declined / cancelled / expired*, that becomes a **proposed status** for the owner to confirm. AI changes never override a status the owner confirmed.
- **Retries:** event keys make retried jobs idempotent.

## 4. Inventory from photos

[`server/utils/mp/inventory.ts`](../server/utils/mp/inventory.ts):

1. **In the browser:** photos are resized to at most 2400 px and saved in Postgres (`mp_inventory_images`).
2. **Pass 1:** the vision model lists each print and may only propose candidate ids **from the catalog list it is given**.
3. **Pass 2:** each candidate's MiniPrint.io reference image is compared with the photo.
4. **Auto-confirm** only when exactly one candidate is judged "same", no text read on the print contradicts it, and the catalog record is verified. Everything else goes to the review queue.
5. **Dedupe across photos:** one item per print. Quantity is the largest count clearly visible in any *single* photo ("at least N"); counts are never summed across photos. Otherwise it's unknown.
6. **Changes:** inventory never changes because of an offer. It changes when the owner confirms a completed trade with "update my inventory", or edits it directly.

Cost note: pass 2 sends the photo once per detected print, so a photo with 30 prints means about 31 model calls.

## 5. Evaluation

[`server/utils/mp/evaluate.ts`](../server/utils/mp/evaluate.ts) is deterministic. It:

1. re-verifies the involved prints on MiniPrint.io;
2. checks the documented inventory and conflicting open commitments;
3. gathers collector history and stated preferences;
4. labels every piece of evidence as *verified catalog fact / stated preference / message fact / AI interpretation / unknown*;
5. lists uncertainties and missing information;
6. suggests **accept / negotiate / decline / request clarification** using explicit rules on the owner's tier ordering.

Results are stored as recommendations only.

## 6. Background jobs

[`server/utils/mp/jobs.ts`](../server/utils/mp/jobs.ts) is a Postgres job table with:

- idempotency keys;
- `FOR UPDATE SKIP LOCKED` claiming and 5-minute leases (a crashed run is reclaimed);
- exponential backoff, then `dead`;
- continuation for long work.

The Eve schedule [`agent/schedules/jobs.ts`](../agent/schedules/jobs.ts) wakes the runner every minute in production. `eve dev` does not fire schedules, so locally use **Run pending jobs** on System health.

## 7. Agent

- **Tools:** the 12 tools in [`agent/tools/`](../agent/tools/) call `/api/internal/mp/tools/:name`. Each input is validated with zod, and the owner id comes from the Eve session, never from the model.
- **Status changes:** `update_trade_status` uses `approval: always()`.
- **Disabled built-ins:** `bash`, `read_file`, `write_file`, `web_fetch` and `web_search`, because the agent reads other people's untrusted messages.
- **Untouched template features:** GitHub and Linear integrations still require explicit connection.
- **Rules:** instructions are in [`agent/instructions.ts`](../agent/instructions.ts) under *MiniPrint trade intelligence*.

## 8. Security and privacy

- **Sign-up is closed.** Only `MP_ALLOWED_EMAILS` may register, or — if that is unset — only the first account. Every `/api/mp/*` route requires a session and scopes queries by owner. `/api/internal/*` requires `INTERNAL_API_SECRET`.
- **Supabase:** migration `0002_enable_rls.sql` enables RLS with no policies on every table, so the Data API (anon key) cannot read anything. The app connects as the table owner. Supabase encrypts data at rest (AES-256) and requires TLS. Connect with `sslmode=require`.
- **Least privilege:** in production, connect as a dedicated role that owns the app's tables, rather than a superuser. Never expose the `service_role` key.
- **Logging:** errors are truncated and contain no message bodies. Model telemetry is disabled for analysis calls.
- **Deletion:** per message, per conversation, per collector, or all message data (Import page). Derived trades, revisions, evaluations, preferences and evidence links are removed with them.
- **Providers to review before importing real messages:**
  - **Vercel AI Gateway:** per its [security and compliance docs](https://vercel.com/docs/ai-gateway/security-and-compliance), prompts and responses are not retained after the request completes. Team-wide [Zero Data Retention](https://vercel.com/docs/ai-gateway/capabilities/zdr) and "prevent prompt training" controls exist on Pro/Enterprise. **Turn on ZDR for this team before importing real messages.**
  - **Model provider** (Anthropic by default): retention follows its API terms and the ZDR routing above.
  - **Supabase / Vercel hosting:** standard DPAs. The database holds message text and photos.

## 9. Runbook

1. Set the env vars ([ENVIRONMENT.md](./ENVIRONMENT.md#miniprint)), deploy, and sign up (first account only).
2. **Catalog → Sync catalog.** Wait about 25 minutes for it to finish.
3. **My inventory → Upload photos.** Review anything flagged.
4. **Import messages:** set your Messenger name, then import both Meta downloads.
5. **Incoming offers / Opportunities:** evaluate, inspect the evidence, record decisions.
