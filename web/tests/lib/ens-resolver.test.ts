import { describe, it, expect, vi } from "vitest";
import { createEnsResolver } from "../../lib/ens-resolver";

describe("ens-resolver", () => {
  it("returns cached name without publishing", async () => {
    const cache = {
      getName: vi.fn().mockResolvedValue("loyal-oak"),
      setName: vi.fn(),
      getAddress: vi.fn(),
    };
    const isClaimed = vi.fn();
    const publish = vi.fn();
    const r = createEnsResolver({ cache: cache as any, isClaimed, publish, parent: "tribunal.eth" });
    const name = await r.ensure("0xabc", "litigant");
    expect(name).toBe("loyal-oak");
    expect(publish).not.toHaveBeenCalled();
  });

  it("derives, finds first unclaimed candidate, publishes, caches", async () => {
    const setName = vi.fn();
    const cache = {
      getName: vi.fn().mockResolvedValue(null),
      setName,
      getAddress: vi.fn(),
    };
    let calls = 0;
    const isClaimed = vi.fn().mockImplementation(async () => {
      calls += 1;
      return calls === 1; // first candidate collides; second is free
    });
    const publish = vi.fn().mockResolvedValue(undefined);
    const r = createEnsResolver({ cache: cache as any, isClaimed, publish, parent: "tribunal.eth" });
    const name = await r.ensure("0xfeed", "lawyer");
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(isClaimed).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledOnce();
    expect(setName).toHaveBeenCalledWith("0xfeed", name);
  });

  it("throws after MAX_ATTEMPTS collisions", async () => {
    const cache = {
      getName: vi.fn().mockResolvedValue(null),
      setName: vi.fn(),
      getAddress: vi.fn(),
    };
    const isClaimed = vi.fn().mockResolvedValue(true); // always taken
    const publish = vi.fn();
    const r = createEnsResolver({ cache: cache as any, isClaimed, publish, parent: "tribunal.eth" });
    await expect(r.ensure("0xdead", "litigant")).rejects.toThrow(/collision/);
  });
});
