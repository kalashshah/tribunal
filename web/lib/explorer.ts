// Explorer URL helpers + deployed addresses. Safe for client bundles —
// addresses + URLs are public data.

export const OG_EXPLORER = "https://chainscan-galileo.0g.ai";
export const OG_STORAGE_SCAN = "https://storagescan-galileo.0g.ai";
export const ENS_APP = "https://sepolia.app.ens.domains";
export const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";

export const DEPLOYMENT = {
  ogGalileo: {
    name: "0G Galileo Testnet",
    chainId: 16602,
    explorer: OG_EXPLORER,
    deployer: "0x369db11Fbdfe58e307B35776c4b7Fca4AE7eA0C4",
    contracts: {
      AgentRegistry:    "0x1B32D545e91a1dD11efb5B8e8336369103C4Cc4C",
      TribunalCore:     "0xC434C901a184c06Bb8911708B65267bD4e6A68a7",
      EscrowAdapter:    "0xE673BAF7C25A7B42e62C668B1562aDA81311F93d",
      VerdictLog:       "0xDBffDCc253Da588549C4d82167d1d5100D9a050a",
      JudgeINFT:        "0x1Bb3C9f7315A3E7787174f9Ddd516cF45DdF08d4",
      RuleBook:         "0x33D6854B4b5ED93F5D4AA7D5f57AA503a41987DA",
      RuleBookGovernor: "0x88da4E565E326Dc258cA56776C8F9821f268D6f5",
    },
  },
  sepolia: {
    name: "Sepolia (ENS)",
    chainId: 11155111,
    parentDomain: "tribunal.eth",
    subnames: [
      "alice.tribunal.eth",
      "bob.tribunal.eth",
      "judge-athena.tribunal.eth",
    ],
  },
} as const;

export type ContractName = keyof typeof DEPLOYMENT.ogGalileo.contracts;

export function ogAddr(address: string): string {
  return `${OG_EXPLORER}/address/${address}`;
}
export function ogTx(hash: string): string {
  return `${OG_EXPLORER}/tx/${hash}`;
}
export function ogToken(contract: string, tokenId: number | string): string {
  // chainscan-galileo follows the etherscan pattern for token instances
  return `${OG_EXPLORER}/token/${contract}?a=${tokenId}`;
}
export function ogContract(name: ContractName): string {
  return ogAddr(DEPLOYMENT.ogGalileo.contracts[name]);
}
export function ensApp(name: string): string {
  return `${ENS_APP}/${name}`;
}
/// Storagescan-galileo's submission page wants the numeric submissionIndex
/// (txSeq), NOT a root hash. The /tx/{hash} path 308-redirects to chainscan,
/// and /submission/{rootHash} renders an empty shell. Pass the txSeq.
export function zgSubmission(txSeq: number | string): string {
  return `${OG_STORAGE_SCAN}/submission/${txSeq}`;
}

export function shortAddr(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
