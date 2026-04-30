// mcp/src/tools.ts (stub — Task 22 replaces this)
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";

export const toolDefinitions: Array<{ name: string; description: string; inputSchema: any }> = [];

export async function registerTools(_req: CallToolRequest): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  throw new Error("No tools registered yet");
}
