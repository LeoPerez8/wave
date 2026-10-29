import { editHomeArrangement, type Catalogue, type HomeArrangementEdit } from "@wave/core";

import type { TitleLongPress } from "@/components/TitleLongPress";
import { pressedRect } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";

import { HomeEditorCard } from "./HomeEditor";

import { currentHomeArrangement, setHomeArrangement } from "./homeArrangementSetting";
export { useHomeArrangement } from "./homeArrangementSetting";

/** Applies [change] to Home's arrangement and saves it at once (Settings › Layout › Home). */
export const editSavedHomeArrangement = (change: HomeArrangementEdit): void =>
  setHomeArrangement(editHomeArrangement(currentHomeArrangement(), change));

/**
 * The Home title's long press: Home's editor, a card next to the title. Done
 * saves the arrangement; Back or a tap outside leaves Home as it was.
 */
export const homeTitleLongPress = (strings: Catalogue): TitleLongPress => ({
  label: strings.home.edit,
  open: () => {
    openOverlay({
      label: strings.home.edit,
      anchor: pressedRect(),
      render: (close) => (
        <HomeEditorCard
          initial={currentHomeArrangement()}
          done={(arrangement) => {
            close();
            setHomeArrangement(arrangement);
          }}
        />
      ),
    });
  },
});
