import {
  LIBRARY_SHELF_CHOICES,
  parseLibraryShelf,
  storedLibraryShelf,
  type LibraryShelf,
} from "@wave/core";

import type { TitleLongPress } from "@/components/TitleLongPress";
import { persistedSetting } from "@/lib/persistedSetting";
import { openTitleChoices } from "@/overlay/titleChoices";
import type { ChoiceSetting } from "@/settings/ChoiceRow";

const libraryShelf = persistedSetting<LibraryShelf>({
  key: "settings.libraryShelf",
  read: parseLibraryShelf,
  write: storedLibraryShelf,
});

/** The shelf under the Library's rows (Recently added until changed); re-renders when it changes. */
export const useLibraryShelf = libraryShelf.useValue;

/**
 * The shelves, offered by the title's long press and by Settings › Layout ›
 * Library alike.
 */
export const libraryShelfChoice: ChoiceSetting<LibraryShelf> = {
  label: "Shelf under the Library",
  choices: LIBRARY_SHELF_CHOICES.map(({ shelf, label }) => ({ value: shelf, label })),
  setting: libraryShelf,
};

/**
 * The Library title's long press: a card of the shelves Home's catalogue
 * offers, then None, the current one checked. Picking one swaps the shelf at
 * once and keeps it across restarts.
 */
export const libraryShelfTitleLongPress: TitleLongPress = {
  label: "Choose the Library's shelf",
  open: () =>
    openTitleChoices({
      label: libraryShelfChoice.label,
      choices: libraryShelfChoice.choices,
      current: libraryShelf.get(),
      choose: libraryShelf.set,
    }),
};
