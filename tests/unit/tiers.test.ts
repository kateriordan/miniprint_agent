import { describe, expect, it } from "vitest";
import { tierFor } from "#shared/miniprint/tiers";

describe("tierFor (owner's ordering)", () => {
  it("orders common < limited < unicorn", () => {
    expect(tierFor("common", "in_circulation")).toBeLessThan(tierFor("limited", "in_circulation")!);
    expect(tierFor("limited", "in_circulation")).toBeLessThan(tierFor("unicorn", "in_circulation")!);
  });
  it("treats out of circulation the same as unicorn", () => {
    expect(tierFor("common", "out_of_circulation")).toBe(tierFor("unicorn", "in_circulation"));
    expect(tierFor("ooc", "unknown")).toBe(tierFor("unicorn", "unknown"));
  });
  it("cannot place an unverified rarity", () => {
    expect(tierFor(null, "in_circulation")).toBeNull();
    expect(tierFor("mystery", "unknown")).toBeNull();
  });
});
