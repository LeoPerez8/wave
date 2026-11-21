import { persistedSetting } from "@/lib/persistedSetting";
import { GENIUS_INSIGHTS_SETTING, readGeniusInsights, writeGeniusInsights } from "@wave/core";

/** Whether Wave may ask Genius about songs (on unless the owner turned it off). */
const insights = persistedSetting<boolean>({
  key: GENIUS_INSIGHTS_SETTING,
  synced: true,
  read: readGeniusInsights,
  write: writeGeniusInsights,
});

export const geniusInsightsEnabled = insights.get;

export const setGeniusInsightsEnabled = insights.set;

/** Whether Genius insights are allowed; re-renders when Settings changes it. */
export const useGeniusInsightsEnabled = insights.useValue;

/** Calls [listener] after each change of the switch; gives the function that stops it. */
export const subscribeGeniusInsights = insights.subscribe;
