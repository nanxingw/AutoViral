import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import styles from "./Glass.module.css";

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: "default" | "lo";
  children: ReactNode;
}

export function Glass({ tone = "default", className, children, ...rest }: Props) {
  return (
    <div className={clsx(styles.glass, tone === "lo" && styles.lo, className)} {...rest}>
      {children}
    </div>
  );
}
