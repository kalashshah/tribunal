// 0G Storage wrapper. Hides SDK details behind a small interface so consumers
// (clerk, judge, lawyer) can be tested with mocks.
//
// Real SDK shape (from @0glabs/0g-ts-sdk types):
//   const indexer = new Indexer(indexerUrl)
//   const memData = new MemData(bytes)
//   const [{ rootHash, txHash }, err] = await indexer.upload(memData, rpcUrl, signer)
//   const err = await indexer.download(rootHash, filePath, proof)

import { keccak256 } from "ethers";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface UploadResult {
  rootHash: `0x${string}`;
  txHash: `0x${string}`;
}

export interface ZgStorage {
  upload(bytes: Uint8Array): Promise<UploadResult>;
  download(rootHash: `0x${string}`): Promise<Uint8Array>;
}

/** Pure helper. Used by clerk to compute a content hash for on-chain anchoring. */
export function contentHash(bytes: Uint8Array): `0x${string}` {
  return keccak256(bytes) as `0x${string}`;
}

// ---- SDK-facing factory --------------------------------------------------

// Minimal structural type of the SDK's Indexer that we depend on. Lets us
// inject a fake in tests without dragging the SDK into the module graph.
export interface SdkIndexer {
  upload(
    file: unknown,
    blockchain_rpc: string,
    signer: unknown,
  ): Promise<[{ rootHash: string; txHash: string }, Error | null]>;
  download(rootHash: string, filePath: string, proof: boolean): Promise<Error | null>;
}

export interface SdkMemDataCtor {
  new (data: ArrayLike<number>): unknown;
}

export interface CreateZgStorageOpts {
  indexer: SdkIndexer;
  memDataCtor: SdkMemDataCtor;
  rpcUrl: string;
  signer: unknown;
  /** Override only for tests. Defaults to OS tmpdir. */
  tmpDir?: string;
}

export function createZgStorage(opts: CreateZgStorageOpts): ZgStorage {
  return {
    async upload(bytes) {
      const file = new opts.memDataCtor(Array.from(bytes));
      const [res, err] = await opts.indexer.upload(file, opts.rpcUrl, opts.signer);
      if (err) throw err;
      return { rootHash: res.rootHash as `0x${string}`, txHash: res.txHash as `0x${string}` };
    },
    async download(rootHash) {
      const dir = opts.tmpDir ?? os.tmpdir();
      const filePath = path.join(dir, `og-${rootHash.slice(2, 14)}-${Date.now()}.bin`);
      const err = await opts.indexer.download(rootHash, filePath, false);
      if (err) throw err;
      try {
        const buf = await fs.readFile(filePath);
        return new Uint8Array(buf);
      } finally {
        await fs.unlink(filePath).catch(() => {});
      }
    },
  };
}
