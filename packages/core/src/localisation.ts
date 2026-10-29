/**
 * Wave's languages (docs/spec.md, "Language"): English, and Brazilian
 * Portuguese while it's in preview. The text itself lives in the catalogues
 * (`catalogueEn.ts`, `cataloguePtBr.ts`); this picks the language and the
 * catalogue; `plural.ts` writes counted phrases.
 */

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
 * Wave has wins. Any Portuguese is Brazilian Portuguese, when
 * [portugueseEnabled] (the developer switch, until Portuguese launches);
 * everything else, and no match at all, is English.
 */
export const resolveAppLanguage = (
  preferred: readonly string[],
  { portugueseEnabled }: { readonly portugueseEnabled: boolean },
): AppLanguage => {
  for (const tag of preferred) {
    const language = primarySubtag(tag);
    if (language === "en") return "en";
    if (language === "pt" && portugueseEnabled) return "pt-BR";
  }
  return "en";
};

const CATALOGUES: Readonly<Record<AppLanguage, Catalogue>> = { en, "pt-BR": ptBR };

/** Every piece of interface text in [language]. */
export const catalogueOf = (language: AppLanguage): Catalogue => CATALOGUES[language];
