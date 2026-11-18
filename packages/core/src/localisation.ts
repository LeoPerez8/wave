/**
 * Wave's languages (docs/spec.md, "Language"): English and Brazilian
 * Portuguese. The text itself lives in the catalogues
 * (`catalogueEn.ts`, `cataloguePtBr.ts`); this picks the language and the
 * catalogue; `plural.ts` writes counted phrases.
 */

import { desktopEn } from "./catalogue/desktopEn.ts";
import { desktopPtBr } from "./catalogue/desktopPtBr.ts";
import { en, type Catalogue } from "./catalogueEn.ts";
import { ptBR } from "./cataloguePtBr.ts";

export type { Catalogue } from "./catalogueEn.ts";

/** A language Wave's interface reads in. */
export type AppLanguage = "en" | "pt-BR";

/** The primary subtag of a BCP 47 tag ("pt" from "pt-BR" or "pt_br"), lower case. */
const primarySubtag = (tag: string): string => tag.split(/[-_]/)[0]!.toLowerCase();

/**
 * The language Wave reads in, from the phone's preferred languages in order
 * (Android's per-app language when set, else the system's): the first one
 * Wave has wins. Any Portuguese is Brazilian Portuguese; everything else,
 * and no match at all, is English.
 */
export const resolveAppLanguage = (preferred: readonly string[]): AppLanguage => {
  for (const tag of preferred) {
    const language = primarySubtag(tag);
    if (language === "en") return "en";
    if (language === "pt") return "pt-BR";
  }
  return "en";
};

/** The kind of device Wave runs on, for the phrases that name it. */
export type Device = "phone" | "desktop";

/** Phrases that replace a catalogue's own, nested as the catalogue nests them. */
export type CatalogueVariants = Variants<Catalogue>;

type Variants<T> = {
  readonly [K in keyof T]?: T[K] extends string | ((...args: never[]) => unknown)
    ? T[K]
    : Variants<T[K]>;
};

const isGroup = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** [base] with each phrase [variants] holds in its place. */
const merge = (
  base: Readonly<Record<string, unknown>>,
  variants: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, variant] of Object.entries(variants)) {
    const own = merged[key];
    merged[key] = isGroup(own) && isGroup(variant) ? merge(own, variant) : variant;
  }
  return merged;
};

const withVariants = (base: Catalogue, variants: CatalogueVariants): Catalogue =>
  merge(base, variants) as Catalogue;

const CATALOGUES: Readonly<Record<Device, Readonly<Record<AppLanguage, Catalogue>>>> = {
  phone: { en, "pt-BR": ptBR },
  desktop: { en: withVariants(en, desktopEn), "pt-BR": withVariants(ptBR, desktopPtBr) },
};

/**
 * Every piece of interface text in [language], as [device] reads it: the
 * desktop says "This computer" where the phone says "This phone".
 */
export const catalogueOf = (language: AppLanguage, device: Device = "phone"): Catalogue =>
  CATALOGUES[device][language];
