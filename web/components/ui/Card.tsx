/**
 * <Card> — standard cream-paper surface with hairline border.
 * Pass `as="article"` (or "aside", "section") for the right semantics.
 */

import type { ElementType, ReactNode } from "react";

interface Props {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  style?: React.CSSProperties;
}

export function Card({ children, as: As = "div", className, style }: Props) {
  return (
    <As className={["card", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </As>
  );
}
