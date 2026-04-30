import { CSSProperties, ReactNode } from "react";

interface ExplorerLinkProps {
  href: string;
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
  className?: string;
}

/// External link to a block / token / address explorer. Opens in a new tab
/// and renders an inline arrow so users know it's leaving the app.
export function ExplorerLink({ href, children, title, style, className }: ExplorerLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={className ? `explorer-link ${className}` : "explorer-link"}
      style={style}
    >
      {children}
      <span className="explorer-link-arrow" aria-hidden="true">↗</span>
    </a>
  );
}
