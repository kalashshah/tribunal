import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createEnsCache } from "../../lib/ens-cache";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ens-cache-"));
});

describe("ens-cache", () => {
  it("returns null for unknown address; sets and returns it", async () => {
    const c = createEnsCache(path.join(dir, "ens.json"));
    expect(await c.getName("0xabc")).toBeNull();
    await c.setName("0xABC", "stoic-falcon");
    expect(await c.getName("0xabc")).toBe("stoic-falcon");
    expect(await c.getName("0xAbC")).toBe("stoic-falcon"); // case-insensitive
  });

  it("supports reverse lookup name → address", async () => {
    const c = createEnsCache(path.join(dir, "ens.json"));
    await c.setName("0xDEAD", "loyal-oak");
    expect(await c.getAddress("loyal-oak")).toBe("0xdead");
    expect(await c.getAddress("nope")).toBeNull();
  });

  it("persists to disk and reloads", async () => {
    const file = path.join(dir, "ens.json");
    const c1 = createEnsCache(file);
    await c1.setName("0xfeed", "wry-fox");
    const c2 = createEnsCache(file);
    expect(await c2.getName("0xFEED")).toBe("wry-fox");
  });
});
