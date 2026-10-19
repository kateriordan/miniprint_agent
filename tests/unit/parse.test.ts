import { describe, expect, it } from "vitest";
import { fixMojibake, mergeConversations, parseExportFile } from "#shared/messenger/parse";

// Facebook writes UTF-8 bytes as \u00XX escapes: "é" → "Ã©", "😀" → four escapes.
const mojibake = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));

describe("fixMojibake", () => {
  it("re-decodes Facebook's byte-escaped UTF-8", () => {
    expect(fixMojibake(mojibake("Café 😀"))).toBe("Café 😀");
  });
  it("leaves normal text alone", () => {
    expect(fixMojibake("plain text")).toBe("plain text");
    expect(fixMojibake("already é")).toBe("already é");
  });
});

const dyiPart = (n: number, messages: unknown[]) => ({
  participants: [{ name: mojibake("Zoë Collector") }, { name: "Kate Owner" }],
  messages,
  title: mojibake("Zoë Collector"),
  thread_path: "inbox/zoecollector_10158123",
  is_still_participant: true,
  _n: n,
});

describe("parseExportFile — Export your information (JSON)", () => {
  it("normalizes messages, attachments and reactions", () => {
    const warnings: string[] = [];
    const conv = parseExportFile("your_facebook_activity/messages/inbox/zoecollector_10158123/message_1.json", dyiPart(1, [
      { sender_name: mojibake("Zoë Collector"), timestamp_ms: 1_712_000_000_000, content: "Would you trade Bodega Cat for 2 commons?", reactions: [{ reaction: mojibake("👍"), actor: "Kate Owner" }] },
      { sender_name: "Kate Owner", timestamp_ms: 1_712_000_100_000, photos: [{ uri: "messages/inbox/zoecollector_10158123/photos/1.jpg", creation_timestamp: 1 }] },
      { timestamp_ms: 1 },
    ]), warnings)!;

    expect(conv.source).toBe("fb_dyi_json");
    expect(conv.sourceKey).toBe("fb_dyi:zoecollector_10158123");
    expect(conv.participants).toContain("Zoë Collector");
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]).toMatchObject({ senderName: "Zoë Collector", text: "Would you trade Bodega Cat for 2 commons?", sourceMessageId: null });
    expect(conv.messages[0]!.reactions).toEqual([{ actor: "Kate Owner", reaction: "👍" }]);
    expect(conv.messages[1]!.attachments).toEqual([{ type: "photo", uri: "messages/inbox/zoecollector_10158123/photos/1.jpg" }]);
    expect(warnings[0]).toMatch(/1 message entries/);
  });

  it("merges message_N parts of the same thread in time order", () => {
    const warnings: string[] = [];
    const a = parseExportFile("messages/inbox/zoecollector_10158123/message_1.json", dyiPart(1, [{ sender_name: "Kate Owner", timestamp_ms: 20, content: "b" }]), warnings)!;
    const b = parseExportFile("messages/inbox/zoecollector_10158123/message_2.json", dyiPart(2, [{ sender_name: "Kate Owner", timestamp_ms: 10, content: "a" }]), warnings)!;
    const merged = mergeConversations([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.messages.map(m => m.text)).toEqual(["a", "b"]);
  });

  it("ignores unrelated JSON files", () => {
    expect(parseExportFile("your_activity/profile.json", { profile: {} }, [])).toBeNull();
  });
});

describe("parseExportFile — encrypted chat download", () => {
  it("accepts the camelCase secure-storage shape", () => {
    const conv = parseExportFile("Zoe.json", {
      participants: ["Zoë Collector", "Kate Owner"],
      threadName: "Zoë Collector",
      messages: [{ senderName: "Zoë Collector", timestamp: 1_712_000_000_000, text: "Still want Pigeon?", media: [], reactions: [], isUnsent: false, type: "text" }],
    }, [])!;
    expect(conv.source).toBe("fb_e2ee_json");
    expect(conv.messages[0]).toMatchObject({ senderName: "Zoë Collector", text: "Still want Pigeon?", timestampMs: 1_712_000_000_000 });
  });
});
