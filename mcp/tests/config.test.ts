import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("returns parsed config when env is complete", () => {
    const cfg = loadConfig({
      TRIBUNAL_AGENT_PRIVATE_KEY: "0x" + "11".repeat(32),
      TRIBUNAL_RPC_URL: "https://rpc.example",
      TRIBUNAL_BACKEND_URL: "https://api.example",
      TRIBUNAL_DEPLOYMENT_PATH: "/tmp/dep.json",
    });
    expect(cfg.privateKey.startsWith("0x")).toBe(true);
    expect(cfg.rpcUrl).toBe("https://rpc.example");
  });
  it("throws when private key is missing", () => {
    expect(() => loadConfig({
      TRIBUNAL_RPC_URL: "x", TRIBUNAL_BACKEND_URL: "y", TRIBUNAL_DEPLOYMENT_PATH: "z",
    })).toThrow(/TRIBUNAL_AGENT_PRIVATE_KEY/);
  });
  it("throws when private key is not 32-byte hex", () => {
    expect(() => loadConfig({
      TRIBUNAL_AGENT_PRIVATE_KEY: "not-hex",
      TRIBUNAL_RPC_URL: "x", TRIBUNAL_BACKEND_URL: "y", TRIBUNAL_DEPLOYMENT_PATH: "z",
    })).toThrow(/private key/);
  });
});
