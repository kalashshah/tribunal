"use client";
import { useEffect, useState } from "react";

export function useEnsName(address: string | undefined): { name: string; loading: boolean } {
  const [name, setName] = useState<string>(address ? truncate(address) : "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/identity/resolve?address=${address}`)
      .then((r) => r.json())
      .then((j: { ensName?: string | null }) => {
        if (cancelled) return;
        if (j.ensName) setName(j.ensName);
        else setName(truncate(address));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [address]);

  return { name, loading };
}

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
