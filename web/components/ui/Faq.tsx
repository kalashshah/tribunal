import type { ReactNode } from "react";

export interface FaqItem {
  q: ReactNode;
  a: ReactNode;
}

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="faq">
      {items.map((it, i) => (
        <details className="faq-item" key={i}>
          <summary className="faq-q">
            <span>{it.q}</span>
            <span className="faq-mark" aria-hidden="true">+</span>
          </summary>
          <div className="faq-a">{it.a}</div>
        </details>
      ))}
    </div>
  );
}
