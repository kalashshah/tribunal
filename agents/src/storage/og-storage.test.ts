import { describe, expect, it, vi } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { contentHash, createZgStorage } from "./og-storage";

describe("contentHash", () => {
  it("returns a 32-byte keccak hex of the input bytes", () => {
    const h = contentHash(new TextEncoder().encode("hello"));
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("differs when input differs", () => {
    expect(contentHash(new TextEncoder().encode("a")))
      .not.toBe(contentHash(new TextEncoder().encode("b")));
  });
});

describe("createZgStorage.upload", () => {
  it("wraps bytes in MemData and forwards rpc + signer to the indexer", async () => {
    class FakeMemData { constructor(public data: ArrayLike<number>) {} }
    const upload = vi.fn(async () => [{ rootHash: "0xabc", txHash: "0xdef" }, null] as const);
    const storage = createZgStorage({
      indexer: { upload, download: vi.fn() } as any,
      memDataCtor: FakeMemData as any,
      rpcUrl: "http://rpc",
      signer: { _kind: "signer" },
    });

    const out = await storage.upload(new Uint8Array([1, 2, 3]));
    expect(out).toEqual({ rootHash: "0xabc", txHash: "0xdef" });
    expect(upload).toHaveBeenCalledOnce();
    const [file, rpc, signer] = upload.mock.calls[0]!;
    expect((file as any).data).toEqual([1, 2, 3]);
    expect(rpc).toBe("http://rpc");
    expect(signer).toEqual({ _kind: "signer" });
  });

  it("throws when the indexer returns an error", async () => {
    class FakeMemData { constructor(public data: ArrayLike<number>) {} }
    const upload = vi.fn(async () => [{ rootHash: "", txHash: "" }, new Error("boom")] as const);
    const storage = createZgStorage({
      indexer: { upload, download: vi.fn() } as any,
      memDataCtor: FakeMemData as any,
      rpcUrl: "http://rpc",
      signer: {},
    });
    await expect(storage.upload(new Uint8Array([1]))).rejects.toThrow("boom");
  });
});

describe("createZgStorage.download", () => {
  it("returns the file bytes the indexer wrote and cleans up the temp file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "og-test-"));
    let writtenPath = "";
    const download = vi.fn(async (_rootHash: string, filePath: string, _proof: boolean) => {
      writtenPath = filePath;
      await fs.writeFile(filePath, new Uint8Array([7, 8, 9]));
      return null;
    });
    const storage = createZgStorage({
      indexer: { download, upload: vi.fn() } as any,
      memDataCtor: class { constructor(_d: ArrayLike<number>) {} } as any,
      rpcUrl: "x",
      signer: {},
      tmpDir,
    });
    const got = await storage.download("0xabcdef0123456789" as `0x${string}`);
    expect(Array.from(got)).toEqual([7, 8, 9]);
    expect(writtenPath.startsWith(tmpDir)).toBe(true);
    await expect(fs.access(writtenPath)).rejects.toThrow();
  });

  it("throws when the indexer returns an error", async () => {
    const download = vi.fn(async () => new Error("not found"));
    const storage = createZgStorage({
      indexer: { download, upload: vi.fn() } as any,
      memDataCtor: class { constructor(_d: ArrayLike<number>) {} } as any,
      rpcUrl: "x",
      signer: {},
    });
    await expect(storage.download("0xabc" as `0x${string}`)).rejects.toThrow("not found");
  });
});
