/** The synced switch for Genius insights, on by default on every device. */
export const GENIUS_INSIGHTS_SETTING = "settings.geniusInsights";

export const readGeniusInsights = (stored: string | null | undefined): boolean => stored !== "off";

export const writeGeniusInsights = (on: boolean): string | null => (on ? null : "off");
