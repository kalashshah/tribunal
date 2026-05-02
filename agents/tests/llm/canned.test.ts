import { describe, expect, it } from "vitest";
import { createCannedLlm, defaultDemoScripts } from "../../src/llm/canned";

describe("createCannedLlm", () => {
  it("returns canned text on first matching script", async () => {
    const llm = createCannedLlm([
      { match: (a) => (a.system.includes("foo") ? "MATCH-FOO" : null) },
      { match: () => "FALLBACK" },
    ]);
    const r = await llm.complete({ system: "foo bar", messages: [] });
    expect(r.text).toBe("MATCH-FOO");
  });

  it("throws when no script matches", async () => {
    const llm = createCannedLlm([{ match: () => null }]);
    await expect(llm.complete({ system: "x", messages: [] })).rejects.toThrow(/no script matched/);
  });
});

describe("defaultDemoScripts", () => {
  const llm = createCannedLlm(defaultDemoScripts());

  it("produces an accuser-lawyer opening", async () => {
    const r = await llm.complete({
      system: "You are an experienced trial lawyer representing the accuser in the Tribunal AI court.",
      messages: [{ role: "user", content: "Opening statement. Use only confirmed facts." }],
    });
    expect(r.text).toMatch(/CLAIM:/);
    expect(r.text).toMatch(/CONCLUSION:/);
  });

  it("produces a defendant-lawyer rebuttal that references the opposing argument", async () => {
    const r = await llm.complete({
      system: "You are an experienced trial lawyer representing the defendant in the Tribunal AI court.",
      messages: [{ role: "user", content: "The accuser just argued:\nfoo\n\nRebut." }],
    });
    expect(r.text).toMatch(/CLAIM:/);
  });

  it("produces a JSON ruling for the judge", async () => {
    const r = await llm.complete({
      system: "You are a judge in the Tribunal, an AI court...",
      messages: [{ role: "user", content: "Trial transcript:\n...\n\nReturn the JSON now." }],
    });
    const parsed = JSON.parse(r.text);
    expect(parsed.prevailingIsAccuser).toBe(true);
    expect(typeof parsed.opinion).toBe("string");
  });
});
