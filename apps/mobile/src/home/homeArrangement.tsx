import {
  editHomeArrangement,
  parseHomeArrangement,
  storedHomeArrangement,
  type HomeArrangement,
  type HomeArrangementEdit,
} from "@wave/core";

import type { TitleLongPress } from "@/components/TitleLongPress";
import { persistedSetting } from "@/lib/persistedSetting";
import { pressedRect } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";

import { HomeEditorCard } from "./HomeEditor";

const sameOrder = (a: HomeArrangement, b: HomeArrangement): boolean =>
  a.sections.length === b.sections.length &&
  a.sections.every((id, index) => id === b.sections[index]) &&
  a.discoverRows.length === b.discoverRows.length &&
  a.discoverRows.every((id, index) => id === b.discoverRows[index]);

const homeArrangement = persistedSetting<HomeArrangement>({
  key: "settings.homeArrangement",
  read: parseHomeArrangement,
  write: storedHomeArrangement,
  equals: sameOrder,
});

/** Home's sections and Discover rows in owner-shown order; follows saved edits. */
export const useHomeArrangement = homeArrangement.useValue;

/** Applies [change] to Home's arrangement and saves it at once (Settings › Layout › Home). */
export const editSavedHomeArrangement = (change: HomeArrangementEdit): void =>
  homeArrangement.set(editHomeArrangement(homeArrangement.get(), change));

/**
 * The Home title's long press: Home's editor, a card next to the title. Done
 * saves the arrangement; Back or a tap outside leaves Home as it was.
 */
export const homeTitleLongPress: TitleLongPress = {
  label: "Edit Home",
  open: () => {
    openOverlay({
      label: "Edit Home",
      anchor: pressedRect(),
      render: (close) => (
        <HomeEditorCard
          initial={homeArrangement.get()}
          done={(arrangement) => {
            close();
            homeArrangement.set(arrangement);
          }}
        />
      ),
    });
  },
};
