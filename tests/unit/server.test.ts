import { describe, expect, it, vi } from "vitest";
import { toUploadChunks } from "../../app/utils/messenger-import";

vi.mock("@nuxthub/db", () => ({ db: {}, schema: {} }));

const { parsePrintPage } = await import("../../server/utils/mp/catalog");
const { messageFingerprint } = await import("../../server/utils/mp/ingest");

/** Same structure miniprint.io print pages embed (fields trimmed). */
function printPage(print: Record<string, unknown>, artist = { id: "ana", slug: "ana-inciardi", name: "Ana Inciardi" }) {
  const data = { props: { pageProps: { print, artist, stats: {} }, __N_SSG: true }, page: "/prints/[artist]/[slug]", buildId: "build-test" };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

describe("parsePrintPage", () => {
  it("reads the catalog record exactly as published", () => {
    const p = parsePrintPage(printPage({ id: 569, title: "1997", slug: "1997", rarity: "limited", is_ooc: false, collection: "Pop Up", img_url: "https://res.cloudinary.com/x.jpg" }), "https://miniprint.io/prints/ana-inciardi/1997");
    expect(p).toMatchObject({
      miniprintId: 569,
      canonicalName: "1997",
      artist: "Ana Inciardi",
      rarity: "limited",
      circulationStatus: "in_circulation",
      catalogUrl: "https://miniprint.io/prints/ana-inciardi/1997",
      buildId: "build-test",
    });
  });

  it("keeps a missing rarity missing and reads the OOC flag", () => {
    const p = parsePrintPage(printPage({ id: 1, title: "X", slug: "x", rarity: null, is_ooc: true }), "u");
    expect(p.rarity).toBeNull();
    expect(p.circulationStatus).toBe("out_of_circulation");
  });

  it("rejects pages without catalog data", () => {
    expect(() => parsePrintPage("<html></html>", "u")).toThrow(/__NEXT_DATA__/);
    expect(() => parsePrintPage(printPage({ title: "no id" }), "u")).toThrow(/Unrecognized/);
  });
});

describe("dedupe fingerprints", () => {
  const base = { sourceMessageId: null, senderName: "Zoë", timestampMs: 1_712_000_000_000, text: "yes", attachments: [], reactions: [], isUnsent: false, ordinal: 0 };

  it("is stable across overlapping imports", () => {
    expect(messageFingerprint("fb_dyi:t1", base)).toBe(messageFingerprint("fb_dyi:t1", { ...base }));
  });

  it("does not rely on text alone", () => {
    const later = messageFingerprint("fb_dyi:t1", { ...base, timestampMs: base.timestampMs + 60_000 });
    const otherThread = messageFingerprint("fb_dyi:t2", base);
    expect(new Set([messageFingerprint("fb_dyi:t1", base), later, otherThread]).size).toBe(3);
  });

  it("keeps genuinely repeated identical messages apart by ordinal", () => {
    const [chunk] = toUploadChunks([{
      source: "fb_dyi_json",
      sourceKey: "fb_dyi:t1",
      title: null,
      participants: ["Zoë", "Kate"],
      isGroup: false,
      folder: "inbox",
      messages: [
        { ...base, ordinal: undefined as never },
        { ...base, ordinal: undefined as never },
        { ...base, text: "no", ordinal: undefined as never },
      ],
    }]);
    const msgs = chunk![0]!.messages;
    expect(msgs.map(m => m.ordinal)).toEqual([0, 1, 0]);
    expect(messageFingerprint("fb_dyi:t1", msgs[0]!)).not.toBe(messageFingerprint("fb_dyi:t1", msgs[1]!));
  });
});
