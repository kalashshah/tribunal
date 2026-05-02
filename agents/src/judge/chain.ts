import type { ZgStorage } from "../storage/og-storage.js";
import type { ChainStep, Ruling } from "./deliberate-loop.js";

export interface ChainManifest {
  version: "tribunal-chain-v1";
  caseId: string;
  model: string;
  ruling: Ruling;
  chain: ChainStep[];
  createdAt: string;
}

export interface BuildArgs {
  caseId: string;
  model: string;
  ruling: Ruling;
  chain: ChainStep[];
}

export function buildChainManifest(a: BuildArgs): ChainManifest {
  return {
    version: "tribunal-chain-v1",
    caseId: a.caseId,
    model: a.model,
    ruling: a.ruling,
    chain: a.chain,
    createdAt: new Date().toISOString(),
  };
}

export interface UploadArgs {
  storage: ZgStorage;
  manifest: ChainManifest;
  /// Renders a viewer URL from a rootHash. Caller supplies — the agent knows
  /// whether to point at storagescan-galileo or a local memory backend.
  url: (rootHash: string) => string;
}

export interface UploadResult { rootHash: `0x${string}`; url: string }

export async function uploadChainManifest({ storage, manifest, url }: UploadArgs): Promise<UploadResult> {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const res = await storage.upload(bytes);
  return { rootHash: res.rootHash, url: url(res.rootHash) };
}
