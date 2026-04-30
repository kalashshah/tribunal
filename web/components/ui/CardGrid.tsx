/**
 * <CardGrid> — auto-fitting grid for cards. Defaults to 3 columns,
 * collapsing responsively. Use for sponsor stacks, judge directories,
 * feature blurbs, etc.
 */

import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  minCardWidth?: number; // px; clamp the auto-fit min
  style?: React.CSSProperties;
}

export function CardGrid({ children, columns = 3, minCardWidth = 240, style }: Props) {
  return (
    <div
      style={{
        display: "grid",
        gap: 18,
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minCardWidth}px), 1fr))`,
        ...style,
      }}
      data-columns={columns}
    >
      {children}
    </div>
  );
}
