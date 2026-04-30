/**
 * <Eyebrow> — small uppercase label that sits above a heading.
 * Pairs with PageHeader and Section but works standalone.
 */

interface Props {
  children: React.ReactNode;
  className?: string;
}

export function Eyebrow({ children, className }: Props) {
  return <span className={["eyebrow", className].filter(Boolean).join(" ")}>{children}</span>;
}
