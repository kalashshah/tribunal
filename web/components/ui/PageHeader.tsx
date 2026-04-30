/**
 * <PageHeader> — eyebrow + display title + lede paragraph. Use at the top
 * of any inner page (file/, judges/, ...) to keep typography consistent.
 */

import type { ReactNode } from "react";
import { Eyebrow } from "./Eyebrow";

interface Props {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;       // optional CTAs / secondary content under the lede
  align?: "left" | "center";
}

export function PageHeader({ eyebrow, title, lede, children, align = "left" }: Props) {
  return (
    <header style={{ marginBottom: 32, textAlign: align }}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", marginTop: eyebrow ? 12 : 0 }}>
        {title}
      </h1>
      {lede ? <p className="lede">{lede}</p> : null}
      {children ? <div style={{ marginTop: 16 }}>{children}</div> : null}
    </header>
  );
}
