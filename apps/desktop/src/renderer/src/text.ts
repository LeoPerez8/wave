import { catalogueOf, resolveAppLanguage } from "@wave/core";
export const text = catalogueOf(resolveAppLanguage(navigator.languages), "desktop");
export const labels = text.desktopLayout;
