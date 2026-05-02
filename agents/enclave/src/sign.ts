/// Enclave envelope signing.
///
/// Each verdict the enclave returns is signed by an "enclave key." Today
/// that key is just an env-loaded eth privkey (no TEE attestation yet).
/// The pattern stays identical when we move to a real TEE: the key is
/// sealed inside the enclave, public key gets registered to TribunalCore
/// alongside an attestation quote, and verifiers check
///   1. envelope signature against the registered enclave pubkey, and
///   2. that the pubkey was bound to a known good attestation.

import { Wallet, getBytes, keccak256, solidityPacked } from "ethers";

export interface VerdictEnvelope {
  caseId: string;
  prevailingIsAccuser: boolean;
  opinionHash: `0x${string}`;
  receiptHash: `0x${string}`;
  receiptUrl: string;
}

export interface SignedEnvelope extends VerdictEnvelope {
  enclaveAddress: string;
  signature: string;
  /// In a real TEE this is the remote-attestation quote bytes. Empty until TEE wiring lands.
  attestation: string;
}

export function envelopeDigest(env: VerdictEnvelope): `0x${string}` {
  return keccak256(
    solidityPacked(
      ["uint256", "bool", "bytes32", "bytes32", "string"],
      [
        BigInt(env.caseId),
        env.prevailingIsAccuser,
        env.opinionHash,
        env.receiptHash,
        env.receiptUrl,
      ],
    ),
  ) as `0x${string}`;
}

export async function signEnvelope(
  env: VerdictEnvelope,
  privKey: string,
): Promise<SignedEnvelope> {
  const wallet = new Wallet(privKey);
  const digest = envelopeDigest(env);
  const signature = await wallet.signMessage(getBytes(digest));
  return {
    ...env,
    enclaveAddress: wallet.address,
    signature,
    attestation: "",
  };
}
