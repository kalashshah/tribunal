"use client";
import { useEnsName } from "./useEnsName";

export function PartyLabel({ address }: { address: string | undefined }) {
  const { name } = useEnsName(address);
  if (!address) return <span>—</span>;
  return <span title={address}>{name}</span>;
}
