import { resolveAppLanguage, type AppLanguage } from "./localisation.ts";

/** The account-wide language choice; System uses each device's own preferred languages. */
export type LanguageChoice = "system" | AppLanguage;
export const LANGUAGE_PREFERENCE = "settings.language";

export const readLanguageChoice = (value: string | null | undefined): LanguageChoice =>
  value === "en" || value === "pt-BR" ? value : "system";

export const chosenAppLanguage = (
  choice: LanguageChoice,
  preferred: readonly string[],
): AppLanguage => (choice === "system" ? resolveAppLanguage(preferred) : choice);
