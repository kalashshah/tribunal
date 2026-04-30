import { describe, it, expect } from "vitest";
import { ADJECTIVES, NOUNS, deriveCandidate } from "./wordlist";

describe("wordlist", () => {
  it("has at least 200 adjectives and 200 nouns, lowercase, no numbers, no hyphens", () => {
    expect(ADJECTIVES.length).toBeGreaterThanOrEqual(200);
    expect(NOUNS.length).toBeGreaterThanOrEqual(200);
    for (const w of [...ADJECTIVES, ...NOUNS]) {
      expect(w).toMatch(/^[a-z]+$/);
    }
  });

  it("deriveCandidate is deterministic for the same address+seed", () => {
    const a = "0x1111111111111111111111111111111111111111";
    expect(deriveCandidate(a, 0)).toEqual(deriveCandidate(a, 0));
  });

  it("deriveCandidate differs across collision attempts", () => {
    const a = "0x2222222222222222222222222222222222222222";
    expect(deriveCandidate(a, 0)).not.toEqual(deriveCandidate(a, 1));
  });

  it("returns adjective-noun joined by hyphen", () => {
    const c = deriveCandidate("0x3333333333333333333333333333333333333333", 0);
    expect(c).toMatch(/^[a-z]+-[a-z]+$/);
  });
});
