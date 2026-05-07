import { useCallback } from "react";
import { useLocaleStore } from "./store";
import { MESSAGES, type Messages } from "./messages";

/**
 * Dot-notation key like "editor.designTab.headlineFont". Strict-typed by
 * walking the nested `Messages` shape so a typo in a `t()` call surfaces
 * at compile time.
 */
type Path<T, P extends string = ""> = T extends string
  ? P
  : {
      [K in keyof T & string]: Path<T[K], P extends "" ? K : `${P}.${K}`>;
    }[keyof T & string];

export type MessageKey = Path<Messages>;

function walk(messages: unknown, key: string): string {
  const parts = key.split(".");
  let node: unknown = messages;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as object)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key; // missing key — surface the key itself so it's findable.
    }
  }
  return typeof node === "string" ? node : key;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const v = params[name];
    return v === undefined || v === null ? `{${name}}` : String(v);
  });
}

export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => {
      const tmpl = walk(MESSAGES[locale], key);
      return interpolate(tmpl, params);
    },
    [locale],
  );
}
