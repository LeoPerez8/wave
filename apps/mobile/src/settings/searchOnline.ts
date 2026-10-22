import {
  readSearchOnline,
  searchOnlineAlways,
  writeSearchOnline,
  type SearchOnline,
} from "@wave/core";
import { useMemo } from "react";

import { persistedSetting } from "@/lib/persistedSetting";
import { onMobileData } from "@/native/waveNative";
import { openTitleChoices } from "@/overlay/titleChoices";

import type { ChoiceSetting } from "./ChoiceRow";

/**
 * Search online (Core's `SearchOnline`): one preference for every Library |
 * Online toggle, kept on this phone. Always opens album and artist pages
 * with Online selected and has Search ask as you type; Always on Wi-Fi does
 * so off mobile data; Only on demand (the default) asks nothing until Online
 * is tapped, except in integrated views.
 */
const searchOnline = persistedSetting<SearchOnline>({
  key: "settings.searchOnline",
  read: readSearchOnline,
  write: writeSearchOnline,
});

/**
 * Whether the view searches online as Always does (Core's
 * `searchOnlineAlways`); re-renders when the preference changes. The network
 * is read once a visit: as the view opens, when the preference changes, and
 * when [visit] does (Search's starts as typing starts in an empty field), so
 * changing networks mid-visit neither flips a page nor asks again.
 */
export const useSearchOnlineAlways = (visit: unknown = null): boolean => {
  const preference = searchOnline.useValue();
  return useMemo(
    () => searchOnlineAlways(preference, { onMobileData: onMobileData() }),
    // [visit] only says when to read the network again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [preference, visit],
  );
};

/** Current eligibility for an automatic artist read, including a network change since opening. */
export const searchOnlineAlwaysNow = (): boolean =>
  searchOnlineAlways(searchOnline.get(), { onMobileData: onMobileData() });

/** Search online's choices, as Settings and the toggle's long-press card both label them. */
const CHOICES: ChoiceSetting<SearchOnline>["choices"] = [
  { value: "always", label: "Always search online" },
  { value: "wifi", label: "Always search on Wi-Fi" },
  { value: "onDemand", label: "Only on demand" },
];

/** Search online as Settings › Accounts lists it, under YT Music. */
export const searchOnlineChoice: ChoiceSetting<SearchOnline> = {
  label: "Search online",
  choices: CHOICES,
  setting: searchOnline,
};

/**
 * The card a long press on any Library | Online toggle opens: Always search
 * online, Always search on Wi-Fi and Only on demand, the current one checked.
 * The choice holds for album pages, artist pages and Search alike.
 */
export const openSearchOnlineChoices = (): void =>
  openTitleChoices({
    label: "Search online",
    choices: CHOICES,
    current: searchOnline.get(),
    choose: searchOnline.set,
  });
