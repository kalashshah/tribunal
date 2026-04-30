// mcp/src/integration.test.ts
import { describe, it, expect, beforeAll, vi } from "vitest";

const TEST_ADDRESS = "0xabcdef1234567890abcdef1234567890abcdef12";

const BACKEND_RESPONSES: Record<string, any> = {
  [`/api/identity/resolve?address=${TEST_ADDRESS}`]: { address: TEST_ADDRESS, ensName: "stoic-falcon" },
  "/api/identity/whoami": { address: "0x1234", ensName: "loyal-oak" },
};

beforeAll(() => {
  process.env.TRIBUNAL_AGENT_PRIVATE_KEY = "0x" + "11".repeat(32);
  process.env.TRIBUNAL_RPC_URL = "http://localhost:8545";
  process.env.TRIBUNAL_BACKEND_URL = "http://test.local";
  process.env.TRIBUNAL_DEPLOYMENT_PATH = "/tmp/no-such-file.json"; // not loaded by resolve tool
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace("http://test.local", "");
    const body = BACKEND_RESPONSES[path] ?? { error: "not stubbed", path };
    return new Response(JSON.stringify(body), { status: 200 });
  });
});

describe("MCP tools (integration)", () => {
  it("tribunal_resolve returns the backend payload verbatim", async () => {
    const { registerTools, toolDefinitions } = await import("./tools");
    expect(toolDefinitions.find((t) => t.name === "tribunal_resolve")).toBeTruthy();
    const out = await registerTools({
      method: "tools/call",
      params: { name: "tribunal_resolve", arguments: { addressOrName: TEST_ADDRESS } },
    } as any);
    expect(out.content[0].text).toContain("stoic-falcon");
  });
});
