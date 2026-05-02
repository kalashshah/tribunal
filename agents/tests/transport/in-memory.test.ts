import { describe, expect, it } from "vitest";
import { createInMemoryBus } from "../../src/transport/in-memory";

describe("createInMemoryBus", () => {
  it("routes a message from sender's outbox to recipient's inbox", async () => {
    const bus = createInMemoryBus();
    const a = bus.newClient("PEER_A");
    const b = bus.newClient("PEER_B");
    await a.send("PEER_B", { kind: "ping", n: 1 });
    expect(bus.totalSent()).toBe(1);
    const env = await b.recv();
    expect(env).toEqual({ from: "PEER_A", payload: { kind: "ping", n: 1 } });
    expect(await b.recv()).toBeNull();
  });

  it("supports many-to-one routing", async () => {
    const bus = createInMemoryBus();
    const a = bus.newClient("A");
    const b = bus.newClient("B");
    const clerk = bus.newClient("CLERK");
    await a.send("CLERK", { from: "a" });
    await b.send("CLERK", { from: "b" });
    const first = await clerk.recv();
    const second = await clerk.recv();
    expect([first?.from, second?.from]).toEqual(["A", "B"]);
  });

  it("peerId() returns the local peer id", async () => {
    const bus = createInMemoryBus();
    const a = bus.newClient("PEER_A");
    expect(await a.peerId()).toBe("PEER_A");
  });
});
