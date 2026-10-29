import type { AppLanguage } from "./localisation.ts";

/** The forms a counted phrase takes; `zero`, when given, reads for 0 instead of the rule. */
export interface PluralForms {
  readonly zero?: string;
  readonly one: string;
  readonly other: string;
}

/**
 * The form of [forms] that [count] takes in [language], by CLDR's cardinal
 * rules for whole numbers: English uses `one` for 1, Portuguese for 0 and 1.
 * Write `zero` where 0 reads better as a phrase ("Nenhuma música"). Written
 * out rather than asked of `Intl.PluralRules`, which Hermes lacks.
 */
export const plural = (language: AppLanguage, count: number, forms: PluralForms): string => {
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  const one = language === "pt-BR" ? count === 0 || count === 1 : count === 1;
  return one ? forms.one : forms.other;
};
