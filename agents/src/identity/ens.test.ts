import { describe, expect, it } from "vitest";
import { agentEnsRecord, ensip25TextRecordKey } from "./ens";

describe("ensip25TextRecordKey", () => {
  it("composes 'verified-agent:<interopAddr>:<agentId>'", () => {
    expect(
      ensip25TextRecordKey({
        registryInteropAddress: "eip155:80087:0x9999000000000000000000000000000000000001",
        agentId: "42",
      }),
    ).toBe(
      "verified-agent:eip155:80087:0x9999000000000000000000000000000000000001:42",
    );
  });
});

describe("agentEnsRecord", () => {
  it("packages required text records for an agent", () => {
    const r = agentEnsRecord({
      registryInteropAddress: "eip155:80087:0xR",
      agentId: "1",
      role: "judge",
      axlPeerId: "PEER123",
      pubKey: "0x04abc",
    });
    expect(r["verified-agent:eip155:80087:0xR:1"]).toBe("1");
    expect(r["agent.role"]).toBe("judge");
    expect(r["agent.axl-peer-id"]).toBe("PEER123");
    expect(r["agent.pubkey"]).toBe("0x04abc");
    expect(r["agent.credentials"]).toBeUndefined();
  });

  it("includes credentials joined by comma when provided", () => {
    const r = agentEnsRecord({
      registryInteropAddress: "eip155:80087:0xR",
      agentId: "1",
      role: "judge",
      axlPeerId: "P",
      pubKey: "0x",
      credentials: ["bar:0g-bar-association", "specialty:textualism"],
    });
    expect(r["agent.credentials"]).toBe("bar:0g-bar-association,specialty:textualism");
  });

  it("includes the ENSIP-25 key derived from the same args", () => {
    const args = {
      registryInteropAddress: "eip155:1:0xR",
      agentId: "7",
      role: "lawyer" as const,
      axlPeerId: "P",
      pubKey: "0x",
    };
    const r = agentEnsRecord(args);
    expect(r[ensip25TextRecordKey(args)]).toBe("1");
  });
});
