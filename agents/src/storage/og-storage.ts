// 0G Storage wrapper. Hides SDK details behind a small interface so consumers
// (clerk, judge, lawyer) can be tested with mocks.
//
// Real SDK shape (from @0glabs/0g-ts-sdk types):
//   const indexer = new Indexer(indexerUrl)
//   const memData = new MemData(bytes)
//   const [{ rootHash, txHash }, err] = await indexer.upload(memData, rpcUrl, signer)
//   const err = await indexer.download(rootHash, filePath, proof)

import { JsonRpcProvider, keccak256 } from "ethers";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface UploadResult {
  rootHash: `0x${string}`;
  txHash: `0x${string}`;
  /// Numeric submission index assigned by the Flow contract. Used to deep-link
  /// storagescan-galileo at /submission/{txSeq}; undefined if the receipt
  /// couldn't be parsed (e.g. fee already paid / file deduped on the node).
  txSeq?: number;
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

/// Topic hash for the Galileo Flow.Submit event:
///   Submit(address indexed sender, bytes32 indexed identity, uint256 submissionIndex,
///          uint256 startPos, uint256 length, (uint256,bytes,(bytes32,uint256)[]) submission)
const FLOW_SUBMIT_TOPIC =
  "0x167ce04d2aa1981994d3a31695da0d785373335b1078cec239a1a3a2c7675555";

async function readSubmissionIndex(rpcUrl: string, txHash: string): Promise<number | undefined> {
  if (!txHash) return undefined;
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash);
    const log = receipt?.logs.find((l) => l.topics[0]?.toLowerCase() === FLOW_SUBMIT_TOPIC);
    if (!log) return undefined;
    // First non-indexed slot in `data` is `submissionIndex` (uint256).
    const idx = BigInt("0x" + log.data.slice(2, 66));
    return Number(idx);
  } catch {
    return undefined;
  }
}

export function createZgStorage(opts: CreateZgStorageOpts): ZgStorage {
  return {
    async upload(bytes) {
      const file = new opts.memDataCtor(Array.from(bytes));
      const [res, err] = await opts.indexer.upload(file, opts.rpcUrl, opts.signer);
      if (err) throw err;
      const txSeq = await readSubmissionIndex(opts.rpcUrl, res.txHash);
      return {
        rootHash: res.rootHash as `0x${string}`,
        txHash: res.txHash as `0x${string}`,
        txSeq,
      };
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
