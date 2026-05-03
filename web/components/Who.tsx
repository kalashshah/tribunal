"use client";
import { ExplorerLink } from "./ExplorerLink";
import { DEPLOYMENT, ensApp, ogAddr, shortAddr } from "../lib/explorer";
import { useEnsName } from "./useEnsName";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function looksLikeTribunalEns(name: string): boolean {
  const parent = DEPLOYMENT.sepolia.parentDomain;
  return name === parent || name.endsWith(`.${parent}`);
}

export function Who({ from }: { from: string }) {
  const isAddr = ADDR_RE.test(from);
  const { name: resolved } = useEnsName(isAddr ? from : undefined);

  if (!isAddr) {
    // No underlying 0G address available — fall back to the ENS app for
    // tribunal-eth subnames (so users can still inspect the name on Sepolia).
    if (looksLikeTribunalEns(from)) {
      return <ExplorerLink href={ensApp(from)}>{from}</ExplorerLink>;
    }
    return <span>{from}</span>;
  }

  const label = resolved && looksLikeTribunalEns(resolved) ? resolved : shortAddr(from);
  return (
    <ExplorerLink href={ogAddr(from)} title={from}>
      {label}
    </ExplorerLink>
  );
}
