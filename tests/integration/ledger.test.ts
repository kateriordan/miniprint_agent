import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@nuxthub/db";
import { createTrade, ownerSetTradeStatus, reviseTrade } from "../../server/utils/mp/ledger";
import type { TradeLine } from "#shared/miniprint/types";

const ownerId = `test-${randomUUID()}`;
let conversationId: string;
const line = (label: string, printId: string | null = null): TradeLine => ({ label, printId, candidatePrintIds: printId ? [printId] : [], matchStatus: printId ? "verified" : "unmatched", quantity: null });

beforeAll(async () => {
  await db.insert(schema.user).values({ id: ownerId, name: "Test", email: `${ownerId}@miniprint.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  const [c] = await db.insert(schema.conversations).values({ ownerId, sourceKey: `test:${ownerId}` }).returning();
  conversationId = c!.id;
});

afterAll(async () => {
  await db.delete(schema.user).where(eq(schema.user.id, ownerId));
});

async function newTrade(eventKey?: string) {
  return createTrade(ownerId, {
    kind: "new_offer",
    conversationId,
    collectorId: null,
    printsRequested: [line("A", "mp-6")],
    printsOffered: [line("B", "mp-5")],
    recordedBy: "ai",
    eventKey,
  });
}

describe("trade ledger rules", () => {
  it("records an AI-detected acceptance as a proposal, not a status", async () => {
    const { tradeId } = await newTrade();
    await reviseTrade(ownerId, tradeId, { kind: "status_change", status: "accepted", recordedBy: "ai", sourceMessageIds: [] });
    const [t] = await db.select().from(schema.trades).where(eq(schema.trades.tradeId, tradeId));
    expect(t!.tradeStatus).toBe("new_offer");
    expect(t!.proposedStatus).toBe("accepted");
  });

  it("never lets AI analysis override a status the owner confirmed", async () => {
    const { tradeId } = await newTrade();
    await ownerSetTradeStatus(ownerId, tradeId, { status: "declined" });
    await reviseTrade(ownerId, tradeId, { kind: "counteroffer", status: "counteroffer", recordedBy: "ai", printsOffered: [line("C")] });
    const [t] = await db.select().from(schema.trades).where(eq(schema.trades.tradeId, tradeId));
    expect(t!.tradeStatus).toBe("declined");
    expect(t!.statusSource).toBe("owner_confirmed");
    // The counteroffer is still kept in history.
    const revs = await db.select().from(schema.tradeRevisions).where(eq(schema.tradeRevisions.tradeId, tradeId));
    expect(revs.map(r => r.kind)).toEqual(expect.arrayContaining(["new_offer", "status_change", "counteroffer"]));
  });

  it("an owner confirmation clears the proposal", async () => {
    const { tradeId } = await newTrade();
    await reviseTrade(ownerId, tradeId, { kind: "status_change", status: "completed", recordedBy: "ai" });
    await ownerSetTradeStatus(ownerId, tradeId, { status: "completed" });
    const [t] = await db.select().from(schema.trades).where(eq(schema.trades.tradeId, tradeId));
    expect(t!.tradeStatus).toBe("completed");
    expect(t!.proposedStatus).toBeNull();
  });

  it("marks a new offer with unmatched prints as needing clarification", async () => {
    const { tradeId } = await createTrade(ownerId, {
      kind: "new_offer", conversationId, collectorId: null, recordedBy: "ai",
      printsRequested: [line("mystery print")], printsOffered: [line("B", "mp-5")],
    });
    const [t] = await db.select().from(schema.trades).where(eq(schema.trades.tradeId, tradeId));
    expect(t!.tradeStatus).toBe("needs_clarification");
  });

  it("applies a retried AI event only once", async () => {
    const key = `evt-${randomUUID()}`;
    const a = await newTrade(key);
    const b = await newTrade(key);
    expect(b).toEqual({ tradeId: a.tradeId, duplicate: true });
    const rev = `rev-${randomUUID()}`;
    await reviseTrade(ownerId, a.tradeId, { kind: "modification", recordedBy: "ai", eventKey: rev, printsOffered: [line("X")] });
    const again = await reviseTrade(ownerId, a.tradeId, { kind: "modification", recordedBy: "ai", eventKey: rev, printsOffered: [line("Y")] });
    expect(again.duplicate).toBe(true);
    const [t] = await db.select().from(schema.trades).where(eq(schema.trades.tradeId, a.tradeId));
    expect(t!.currentRevision).toBe(2);
    expect(t!.printsOffered[0]!.label).toBe("X");
  });
});
