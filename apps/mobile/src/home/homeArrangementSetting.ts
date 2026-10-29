import { parseHomeArrangement, storedHomeArrangement, type HomeArrangement } from "@wave/core";
import { persistedSetting } from "@/lib/persistedSetting";

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

export const currentHomeArrangement = homeArrangement.get;
export const setHomeArrangement = homeArrangement.set;
export const useHomeArrangement = homeArrangement.useValue;
