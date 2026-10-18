import { readSearchOnline, writeSearchOnline, type SearchOnline } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { openTitleChoices } from "@/overlay/titleChoices";

import type { ChoiceSetting } from "./ChoiceRow";

/**
 * Search online (Core's `SearchOnline`): one preference for every Library |
 * Online toggle, kept on this phone. Always opens album and artist pages
 * with Online selected and has Search ask as you type; Only on demand (the
 * default) asks nothing until Online is tapped, except in integrated views.
 */
const searchOnline = persistedSetting<SearchOnline>({
  key: "settings.searchOnline",
  read: readSearchOnline,
  write: writeSearchOnline,
});

/** Whether Search online is set to Always; re-renders when it changes. */
export const useSearchOnlineAlways = (): boolean => searchOnline.useValue() === "always";

/** Search online as Settings › Accounts lists it, under YT Music. */
export const searchOnlineChoice: ChoiceSetting<SearchOnline> = {
  label: "Search online",
  choices: [
    { value: "always", label: "Always" },
    { value: "onDemand", label: "On demand" },
  ],
  setting: searchOnline,
};

/**
 * The card a long press on any Library | Online toggle opens: Always search
 * online and Only on demand, the current one checked. The choice holds for
 * album pages, artist pages and Search alike.
 */
export const openSearchOnlineChoices = (): void =>
  openTitleChoices({
    label: "Search online",
    choices: [
      { value: "always", label: "Always search online" },
      { value: "onDemand", label: "Only on demand" },
    ],
    current: searchOnline.get(),
    choose: searchOnline.set,
  });
