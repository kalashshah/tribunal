"use client";
import { useEnsName } from "./useEnsName";
import { ExplorerLink } from "./ExplorerLink";
import { ogAddr } from "../lib/explorer";

export function PartyLabel({ address }: { address: string | undefined }) {
  const { name } = useEnsName(address);
  if (!address) return <span>—</span>;
  return (
    <ExplorerLink href={ogAddr(address)} title={address}>
      {name}
    </ExplorerLink>
  );
}
