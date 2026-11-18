/**
 * The side panel's tabs (docs/spec-desktop.md, Window and layout): Lyrics and Queue, and Related
 * (story 44a) while YouTube Music is on.
 */
export type PanelTab = "lyrics" | "queue" | "related";

export const panelTabs = (ytMusic: boolean): readonly PanelTab[] =>
  ytMusic ? ["lyrics", "queue", "related"] : ["lyrics", "queue"];

/** The tab the panel shows for [tab]: Related gives way to the Queue once YouTube Music is off. */
export const shownPanelTab = (tab: PanelTab, ytMusic: boolean): PanelTab =>
  tab === "related" && !ytMusic ? "queue" : tab;

/** The tab [step] places after [tab] (←/→ on the tab list), going round. */
export const stepPanelTab = (tab: PanelTab, step: 1 | -1, ytMusic: boolean): PanelTab => {
  const tabs = panelTabs(ytMusic);
  return tabs[(tabs.indexOf(shownPanelTab(tab, ytMusic)) + step + tabs.length) % tabs.length]!;
};
