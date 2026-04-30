/**
 * <Button> — renders an <a> when `href` is provided, otherwise a <button>.
 * variant="primary" (default, dark filled) or "ghost" (outline only).
 * Both fall back to the .btn class so any consumer can still style with raw <a className="btn">.
 */

import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost";

type ButtonAsAnchor = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: Variant;
};
type ButtonAsButton = ButtonHTMLAttributes<HTMLButtonElement> & {
  href?: undefined;
  variant?: Variant;
};

type Props = ButtonAsAnchor | ButtonAsButton;

function classes(variant: Variant | undefined, extra?: string) {
  return ["btn", variant === "ghost" ? "btn-ghost" : "", extra]
    .filter(Boolean)
    .join(" ");
}

export function Button(props: Props) {
  const { variant, className, ...rest } = props;
  if ("href" in rest && rest.href) {
    return <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} className={classes(variant, className)} />;
  }
  return <button {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} className={classes(variant, className)} />;
}
