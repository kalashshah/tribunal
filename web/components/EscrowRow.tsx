"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

interface Props {
  href: string;
  children: ReactNode;
}

/// Clickable <tr> that navigates on row click. Behaves like a link: middle-click
/// / cmd-click open in a new tab via the underlying push, plain click navigates.
export function EscrowRow({ href, children }: Props) {
  const router = useRouter();
  return (
    <tr
      onClick={(e) => {
        // Don't intercept clicks on nested links / buttons / form controls.
        const t = e.target as HTMLElement;
        if (t.closest("a,button,input,select,textarea")) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        router.push(href);
      }}
      style={{
        borderBottom: "1px solid var(--border, #f0e9d6)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "var(--paper-shade)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
    >
      {children}
    </tr>
  );
}
