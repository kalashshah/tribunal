// web/lib/ens-cache.ts
import * as fs from "node:fs";
import * as path from "node:path";

interface CacheData {
  byAddress: Record<string, string>; // lowercase address -> name
  byName: Record<string, string>;    // name -> lowercase address
}

export interface EnsCache {
  getName(address: string): Promise<string | null>;
  getAddress(name: string): Promise<string | null>;
  setName(address: string, name: string): Promise<void>;
}

export function createEnsCache(filePath: string): EnsCache {
  function load(): CacheData {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as CacheData;
    } catch {
      return { byAddress: {}, byName: {} };
    }
  }
  function save(d: CacheData) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(d, null, 2));
  }
  return {
    async getName(address) {
      const d = load();
      return d.byAddress[address.toLowerCase()] ?? null;
    },
    async getAddress(name) {
      const d = load();
      return d.byName[name] ?? null;
    },
    async setName(address, name) {
      const d = load();
      const lower = address.toLowerCase();
      d.byAddress[lower] = name;
      d.byName[name] = lower;
      save(d);
    },
  };
}
