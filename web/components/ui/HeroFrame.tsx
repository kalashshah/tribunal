/**
 * <HeroFrame> — the double-bordered cream frame around an image. Reusable
 * for the landing painting and any future "exhibit" treatment elsewhere
 * (e.g. judge portraits, case archive thumbnails).
 */

import Image from "next/image";

interface Props {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
}

export function HeroFrame({ src, alt, width = 1600, height = 1200, priority, className }: Props) {
  return (
    <div className={["hero-frame", className].filter(Boolean).join(" ")}>
      <Image src={src} alt={alt} width={width} height={height} priority={priority} />
    </div>
  );
}
