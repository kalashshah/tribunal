export interface MCPConfig {
  privateKey: `0x${string}`;
  rpcUrl: string;
  backendUrl: string;
  deploymentPath: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): MCPConfig {
  const pk = env.TRIBUNAL_AGENT_PRIVATE_KEY;
  if (!pk) throw new Error("TRIBUNAL_AGENT_PRIVATE_KEY not set");
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("TRIBUNAL_AGENT_PRIVATE_KEY must be 0x-prefixed 32-byte hex (private key)");
  const rpcUrl = env.TRIBUNAL_RPC_URL;
  if (!rpcUrl) throw new Error("TRIBUNAL_RPC_URL not set");
  const backendUrl = env.TRIBUNAL_BACKEND_URL;
  if (!backendUrl) throw new Error("TRIBUNAL_BACKEND_URL not set");
  const deploymentPath = env.TRIBUNAL_DEPLOYMENT_PATH;
  if (!deploymentPath) throw new Error("TRIBUNAL_DEPLOYMENT_PATH not set");
  return { privateKey: pk as `0x${string}`, rpcUrl, backendUrl, deploymentPath };
}
