// ENS text-record resolver, scoped to the Tribunal rulebook flow.
//
// Given a namehash (bytes32) and a record key (e.g. "description"), reads
// the ENS public resolver on Sepolia and returns the stored string, or
// null if absent. Pluggable per the EnsResolver interface in rulebook.ts.

import type { EnsResolver } from "./rulebook.js";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;

const REGISTRY_ABI = [
  {
    name: "resolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

const RESOLVER_ABI = [
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "bytes32", name: "node" }, { type: "string", name: "key" }],
    outputs: [{ type: "string" }],
  },
] as const;

export interface CreateEnsResolverOpts {
  rpcUrl: string;
}

export async function createEnsResolver(opts: CreateEnsResolverOpts): Promise<EnsResolver> {
  const { createPublicClient, http } = await import("viem");
  const { sepolia } = await import("viem/chains");
  const client = createPublicClient({ chain: sepolia, transport: http(opts.rpcUrl) });

  // Resolver lookups are stable for a given node — cache them so we don't
  // hit the registry once per (node, key).
  const resolverCache = new Map<string, `0x${string}`>();

  return {
    async resolveText(ensNode, key) {
      let resolver = resolverCache.get(ensNode);
      if (!resolver) {
        const r = await client.readContract({
          address: ENS_REGISTRY,
          abi: REGISTRY_ABI,
          functionName: "resolver",
          args: [ensNode],
        }) as `0x${string}`;
        if (r === "0x0000000000000000000000000000000000000000") return null;
        resolver = r;
        resolverCache.set(ensNode, r);
      }
      const value = await client.readContract({
        address: resolver,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [ensNode, key],
      }) as string;
      return value === "" ? null : value;
    },
  };
}

/// Pure helper: compute the namehash for chapter-X-Y.rulebook.tribunal.eth
/// without doing a viem import. Useful in deploy scripts and tests.
export function chapterEnsNode(articleId: string, parent = "rulebook.tribunal.eth"): Promise<`0x${string}`> {
  return import("viem").then(({ namehash }) => namehash(`chapter-${articleId.replace(/\./g, "-")}.${parent}`) as `0x${string}`);
}
