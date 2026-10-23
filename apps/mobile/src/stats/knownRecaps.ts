import { parseKnownRecaps, storedKnownRecaps, type RecapPeriod } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/** The last discovered availability on this phone, read synchronously on Home's first render. */
export const knownRecapSetting = persistedSetting<readonly RecapPeriod[] | undefined>({
  key: "recaps.available",
  read: parseKnownRecaps,
  write: storedKnownRecaps,
  equals: (a, b) => storedKnownRecaps(a) === storedKnownRecaps(b),
});
