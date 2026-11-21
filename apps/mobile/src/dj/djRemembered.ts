/**
 * What DJ remembers (docs/spec.md, DJ): the selection and Adjust choices its
 * last queue was started with, kept on this phone (not synced) under one
 * setting, so DJ reopens with them.
 */
import {
  DJ_REMEMBERED_SETTING,
  readDjRemembered,
  storedDjRemembered,
  type DjRemembered,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

export const djRemembered = persistedSetting<DjRemembered>({
  key: DJ_REMEMBERED_SETTING,
  read: readDjRemembered,
  write: storedDjRemembered,
  equals: (a, b) => storedDjRemembered(a) === storedDjRemembered(b),
});
