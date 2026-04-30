/**
 * <Section> — content block with an optional eyebrow + heading + lede.
 * Stack multiple <Section>s in a page; the global stylesheet adds the
 * vertical rhythm between siblings.
 */

import type { ReactNode } from "react";
import { Eyebrow } from "./Eyebrow";

interface Props {
  eyebrow?: ReactNode;
  title?: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ eyebrow, title, lede, children, className }: Props) {
  return (
    <section className={["page-section", className].filter(Boolean).join(" ")}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      {title ? <h2>{title}</h2> : null}
      {lede ? <p className="lede">{lede}</p> : null}
      <div style={{ marginTop: title || lede || eyebrow ? 24 : 0 }}>{children}</div>
    </section>
  );
}
