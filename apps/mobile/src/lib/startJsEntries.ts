/**
 * Wraps the ways into the JS thread for the block log (#1531, `jsEntries.ts`), imported right
 * after the app log (index.ts) so the listeners modules add as they load are timed too. The app
 * log has loaded Expo and React Native already, so this changes no load order.
 */
import { EventEmitter } from "expo";
import { DeviceEventEmitter } from "react-native";

import { installJsEntries, type JsEntryTargets } from "./jsEntries";

/** Starts sending the timed runs to the block log (`lib/backgroundWork.ts`). */
export const sendJsEntriesTo = installJsEntries({
  scope: globalThis as unknown as Record<string, unknown>,
  deviceEvents: DeviceEventEmitter as unknown as JsEntryTargets["deviceEvents"],
  expoEmitter: EventEmitter as unknown as JsEntryTargets["expoEmitter"],
  now: () => performance.now(),
});
