// Tiny ICU-free translator: resolves a dotted `key` against the message tree and
// substitutes `{placeholder}` tokens. Shared by the server (`./server`) and
// client (`./provider`) so both render identically. Messages are plain strings —
// serializable across the server → client boundary.

import type { Messages } from "./messages/en";

export type TranslationVars = Record<string, string | number>;

/** A scoped translator, e.g. `t("welcome", { name })` for namespace `home`. */
export type Translator = (key: string, vars?: TranslationVars) => string;

function resolve(messages: Messages, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[part];
    return undefined;
  }, messages);
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

/** Build a translator bound to a catalog and an optional namespace prefix. */
export function createTranslator(messages: Messages, namespace?: string): Translator {
  return (key, vars) => {
    const path = namespace ? `${namespace}.${key}` : key;
    const value = resolve(messages, path);
    // Fall back to the key itself so a missing string is visible, not blank.
    return typeof value === "string" ? interpolate(value, vars) : path;
  };
}
