import { ethers } from "ethers";
import * as fs from "node:fs";
import type { MCPConfig } from "./config.js";

export interface ChainContext {
  provider: ethers.JsonRpcProvider;
  wallet: ethers.Wallet;
  contracts: { AgentRegistry: string; TribunalCore: string };
}

export function createChainContext(cfg: MCPConfig): ChainContext {
  const j = JSON.parse(fs.readFileSync(cfg.deploymentPath, "utf8"));
  const c = j?.chains?.ogGalileo?.contracts ?? j?.legacy ?? j;
  if (!c?.TribunalCore || !c?.AgentRegistry) throw new Error("TribunalCore/AgentRegistry missing in deployment.json");
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const wallet   = new ethers.Wallet(cfg.privateKey, provider);
  return { provider, wallet, contracts: { AgentRegistry: c.AgentRegistry, TribunalCore: c.TribunalCore } };
}
