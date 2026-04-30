// scripts/mcp-demo.ts
// Minimal driver that exercises the MCP server via a child process,
// using the JSON-RPC stdio protocol. Used by `npm run demo:mcp`.
import { spawn } from "node:child_process";
import * as path from "node:path";

const proc = spawn("node", [path.resolve(__dirname, "../mcp/dist/index.js")], {
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"],
});

let id = 0;
function send(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = { jsonrpc: "2.0", id: ++id, ...req };
    proc.stdout!.once("data", (chunk) => {
      const line = chunk.toString().split("\n").find((l: string) => l.trim().startsWith("{"));
      if (!line) return reject(new Error("no JSON in response: " + chunk));
      resolve(JSON.parse(line));
    });
    proc.stdin!.write(JSON.stringify(payload) + "\n");
  });
}

async function main() {
  const list = await send({ method: "tools/list" });
  console.log("Tools:", list.result?.tools?.map((t: any) => t.name));

  const me = await send({
    method: "tools/call",
    params: { name: "tribunal_whoami", arguments: {} },
  });
  console.log("whoami →", me.result?.content?.[0]?.text);

  const filed = await send({
    method: "tools/call",
    params: {
      name: "tribunal_file_case",
      arguments: {
        defendant: process.env.DEMO_DEFENDANT_ADDRESS,
        accusation: "DEMO accusation: defendant breached the data-supply contract.",
      },
    },
  });
  console.log("file_case →", filed.result?.content?.[0]?.text);

  proc.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
