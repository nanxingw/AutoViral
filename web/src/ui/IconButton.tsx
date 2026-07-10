import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import styles from "./IconButton.module.css";

export type IconButtonSize = "compact" | "sm" | "md" | "lg";
export type IconButtonVariant = "ghost" | "surface" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  variant?: IconButtonVariant;
}

/**
 * Icon-only button. Solves the systematic off-centre glyph problem (PRD-0013 S2):
 * the leaked `.studio-shell` pill padding shoved fixed-size icon glyphs ~3–6px
 * right of centre. This shell forces `padding:0 · inline-grid · place-items:center
 * · line-height:0` and stamps `data-bare` (real pill opt-out after the globals.css
 * :where() rewrite) plus `data-icon-button` (the structural marker tests assert).
 *
 * The child is expected to be an SVG icon; it is wrapped in an aria-hidden span so
 * assistive tech reads the required accessible name (aria-label / aria-labelledby),
 * not the decorative glyph. NOT for text or number buttons (reader TOC / edit) —
 * `line-height:0` + SVG-only styling would break their type.
 */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { size = "md", variant = "ghost", className, children, type, ...rest },
  ref,
) {
  if (
    process.env.NODE_ENV !== "production" &&
    !rest["aria-label"] &&
    !rest["aria-labelledby"]
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      "IconButton: an icon-only button needs an accessible name — pass aria-label or aria-labelledby.",
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      data-bare
      data-icon-button
      className={clsx(styles.iconBtn, styles[size], styles[variant], className)}
      {...rest}
    >
      <span className={styles.icon} aria-hidden="true">
        {children}
      </span>
    </button>
  );
});
