import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import styles from "./Button.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost";
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "default", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        styles.btn,
        variant === "primary" && styles.primary,
        variant === "ghost" && styles.ghost,
        className,
      )}
      {...rest}
    />
  );
});
