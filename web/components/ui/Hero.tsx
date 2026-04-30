/**
 * <Hero> — landing-style centred hero with framed image, display title,
 * italic subtitle, and CTAs. Title and subtitle accept ReactNode so you
 * can pass <em>italic</em> spans in the title.
 */

import type { ReactNode } from "react";
import { HeroFrame } from "./HeroFrame";

interface ImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

interface Props {
  image: ImageProps;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode; // typically a fragment of <Button>s
}

export function Hero({ image, title, subtitle, actions }: Props) {
  return (
    <section className="hero">
      <HeroFrame {...image} priority />
      <h1 className="hero-title">{title}</h1>
      {subtitle ? <p className="hero-sub">{subtitle}</p> : null}
      {actions ? <div className="hero-cta">{actions}</div> : null}
    </section>
  );
}
