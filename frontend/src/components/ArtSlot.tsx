import { useState, type ReactNode } from "react";
export function ArtSlot({
  src,
  alt,
  children,
  className = "",
}: {
  src: string | null;
  alt: string;
  children: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return src && src !== failed ? (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setFailed(src)}
    />
  ) : (
    <>{children}</>
  );
}
