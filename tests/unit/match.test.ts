import { describe, expect, it } from "vitest";
import { editDistance, matchPrintName, normalizeName } from "#shared/miniprint/match";
import type { MatchablePrint } from "#shared/miniprint/match";

const ana = (id: number, name: string): MatchablePrint => ({ printId: `mp-${id}`, canonicalName: name, artist: "Ana Inciardi", artistSlug: "ana-inciardi" });
const catalog: MatchablePrint[] = [
  ana(1, "2024 Champions"),
  ana(2, "2025 Champ"),
  ana(3, "Bodega Cat"),
  ana(4, "Bodega Cats"),
  ana(5, "Café Mocha"),
  ana(6, "Pigeon"),
  ana(7, "Rockefeller Center Tree"),
  ana(8, "A Slice"),
  { printId: "mp-9", canonicalName: "Pigeon", artist: "Jen Scribbles", artistSlug: "jen-scribbles" },
  ana(10, "Rock & Roll"),
];

describe("normalizeName", () => {
  it("ignores case, accents, punctuation and a leading 'the'", () => {
    expect(normalizeName("  The CAFÉ  Mocha! ")).toBe("cafe mocha");
    expect(normalizeName("Rock & Roll")).toBe(normalizeName("rock and roll"));
  });
});

describe("matchPrintName", () => {
  it("verifies harmless variations", () => {
    expect(matchPrintName("cafe mocha", catalog)).toMatchObject({ status: "verified", printId: "mp-5" });
    expect(matchPrintName("ROCK AND ROLL", catalog)).toMatchObject({ status: "verified", printId: "mp-10" });
  });

  it("never matches different numbers", () => {
    const r = matchPrintName("2024 Champ", catalog);
    expect(r.status).not.toBe("verified");
    expect(r.candidates).not.toContain("mp-2");
  });

  it("does not merge two prints whose names differ by one letter", () => {
    const r = matchPrintName("Bodega Catz", catalog);
    expect(r.status).toBe("ambiguous");
    expect(r.printId).toBeNull();
    expect(r.candidates).toEqual(expect.arrayContaining(["mp-3", "mp-4"]));
  });

  it("offers a misspelling only as a candidate needing review", () => {
    const r = matchPrintName("Rockefeller Centre Tree", catalog);
    expect(r).toMatchObject({ status: "candidate", printId: null, candidates: ["mp-7"] });
  });

  it("flags the same title by two artists as ambiguous unless the artist is given", () => {
    expect(matchPrintName("pigeon", catalog).status).toBe("ambiguous");
    expect(matchPrintName("pigeon", catalog, { artist: "Jen Scribbles" })).toMatchObject({ status: "verified", printId: "mp-9" });
  });

  it("does not fuzzy-match short names", () => {
    expect(matchPrintName("Pigeo", catalog, { artist: "ana-inciardi" }).status).not.toBe("verified");
  });

  it("returns unmatched for unknown prints", () => {
    expect(matchPrintName("Totally Unknown Print", catalog).status).toBe("unmatched");
  });
});

describe("editDistance", () => {
  it("counts transpositions as one edit", () => {
    expect(editDistance("pigoen", "pigeon")).toBe(1);
  });
});
