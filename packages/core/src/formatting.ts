import type { AppLanguage } from "./localisation.ts";

const numberFormats = new Map<AppLanguage, Intl.NumberFormat>();

/** Grouped numbers in the interface's language, including decimal separators. */
export const formatNumber = (language: AppLanguage, value: number): string => {
  let formatter = numberFormats.get(language);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(language);
    numberFormats.set(language, formatter);
  }
  return formatter.format(value);
};

const timeFormats = new Map<AppLanguage, Intl.DateTimeFormat>();

/** Listening History's local clock: 2:05 PM in English, 14:05 in Portuguese. */
export const formatTime = (language: AppLanguage, value: Date | number): string => {
  let formatter = timeFormats.get(language);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(language === "en" ? "en-US" : language, {
      hour: language === "en" ? "numeric" : "2-digit",
      minute: "2-digit",
    });
    timeFormats.set(language, formatter);
  }
  // DateTimeFormat can insert a narrow no-break space before AM/PM; the old
  // toLocaleTimeString output uses a plain space.
  return formatter.format(value).replace(/\u202f/g, " ");
};

/** Local calendar date; options preserve each screen's existing date shape. */
export const formatDate = (
  language: AppLanguage,
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string => new Intl.DateTimeFormat(language === "en" ? "en-US" : language, options).format(value);
