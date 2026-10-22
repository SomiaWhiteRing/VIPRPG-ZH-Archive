import type { CSSProperties, ReactNode } from "react";

export function TextSize({ size, children }: { size: CSSProperties["fontSize"]; children: ReactNode }) {
  return <span style={{ fontSize: size }}>{children}</span>;
}
