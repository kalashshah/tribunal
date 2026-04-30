import { deriveCandidate } from "./wordlist";
import type { EnsCache } from "./ens-cache";

export interface EnsResolverDeps {
  cache: EnsCache;
  isClaimed(name: string): Promise<boolean>;
  publish(name: string, address: string, role: string): Promise<void>;
  parent: string; // e.g. "tribunal.eth"
}

export interface EnsResolver {
  ensure(address: string, role: string): Promise<string>;
}

const MAX_ATTEMPTS = 8;

export function createEnsResolver(deps: EnsResolverDeps): EnsResolver {
  return {
    async ensure(address, role) {
      const cached = await deps.cache.getName(address);
      if (cached) return cached;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const candidate = deriveCandidate(address, attempt);
        const taken = await deps.isClaimed(candidate);
        if (!taken) {
          await deps.publish(candidate, address, role);
          await deps.cache.setName(address, candidate);
          return candidate;
        }
      }
      throw new Error(`ENS name collision: exhausted ${MAX_ATTEMPTS} attempts for ${address}`);
    },
  };
}
