import { catalogueOf, resolveAppLanguage } from "@wave/core";
export const language = resolveAppLanguage(navigator.languages);
export const text = catalogueOf(language, "desktop");
export const labels = text.desktopLayout;
