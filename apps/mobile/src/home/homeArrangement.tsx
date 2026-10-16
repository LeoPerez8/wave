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
  a.length === b.length && a.every((id, index) => id === b[index]);

const homeArrangement = persistedSetting<HomeArrangement>({
  key: "settings.homeArrangement",
  read: parseHomeArrangement,
  write: storedHomeArrangement,
  equals: sameOrder,
});

/** The sections Home shows, in order (Core's default until changed); re-renders when it changes. */
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
