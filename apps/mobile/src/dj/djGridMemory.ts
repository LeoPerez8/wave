import { DJ_GRID_SETTING, readDjGridMemory, storedDjGridMemory, type DjTile } from "@wave/core";
import { persistedSetting } from "@/lib/persistedSetting";

export const djGridMemory = persistedSetting<readonly DjTile[] | null>({
  key: DJ_GRID_SETTING,
  read: readDjGridMemory,
  write: storedDjGridMemory,
  equals: (a, b) => storedDjGridMemory(a ?? []) === storedDjGridMemory(b ?? []),
});
