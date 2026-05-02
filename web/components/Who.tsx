"use client";
import { ExplorerLink } from "./ExplorerLink";
import { DEPLOYMENT, ensApp, shortAddr } from "../lib/explorer";
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
    if (looksLikeTribunalEns(from)) {
      return <ExplorerLink href={ensApp(from)}>{from}</ExplorerLink>;
    }
    return <span>{from}</span>;
  }

  if (resolved && looksLikeTribunalEns(resolved)) {
    return (
      <ExplorerLink href={ensApp(resolved)} title={from}>
        {resolved}
      </ExplorerLink>
    );
  }
  return <span title={from}>{shortAddr(from)}</span>;
}
