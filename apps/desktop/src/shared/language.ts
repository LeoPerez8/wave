import type { AppLanguage, LanguageChoice } from "@wave/core";

/** Resolved in main for every desktop consumer. */
export interface LanguageView {
  readonly choice: LanguageChoice;
  readonly language: AppLanguage;
}
