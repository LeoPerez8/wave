import { useEffect } from "react";

import { WaveNative } from "@/native/waveNative";

import { openSharedText } from "./importPlaylistLink";

/**
 * Opens what's shared to Wave from another app's share sheet (`openSharedText`):
 * the share that started Wave, then each one while it runs. Waits for [ready]
 * (the Library's screens are up), keeping a share made before then for when
 * they are. Called once, by the root layout.
 */
export const useOpenSharedText = (ready: boolean): void => {
  useEffect(() => {
    if (!ready) return;
    const openPending = () => {
      const text = WaveNative.takeSharedText();
      if (text !== null) openSharedText(text);
    };
    const subscription = WaveNative.addListener("onShareReceived", openPending);
    openPending();
    return () => subscription.remove();
  }, [ready]);
};
