import {
  accountsSummary,
  counted,
  downloadsSummary,
  libraryLookupProgress,
  type SettingsPage,
  type WaveSession,
  type YtSession,
} from "@wave/core";
import * as Result from "effect/Result";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { useLibraryLookup } from "@/library/findLyricsAndGenre";
import { useScanRoots, useScanState } from "@/library/hooks";
import { WaveAccount } from "@/native/waveAccount";
import { WaveYtMusic } from "@/native/waveYtMusic";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { useFailedDownloads, useQueuedDownloads } from "@/ytmusic/YtDownloads";

/**
 * The accounts this phone is signed into (Core's `accountsSummary`), from the
 * sessions the native modules hold, without asking YouTube or Wave's server.
 * Read again each time Settings shows, so a sign-in on Accounts is there on
 * the way back.
 */
const useAccountsSummary = (): string | null => {
  const [yt, setYt] = useState<YtSession>({ status: "signedOut" });
  const [wave, setWave] = useState<WaveSession>({ status: "signedOut" });

  useEffect(() => {
    const ytChanged = WaveYtMusic.addListener("onSessionChanged", setYt);
    const waveChanged = WaveAccount.addListener("onSessionChanged", setWave);
    return () => {
      ytChanged.remove();
      waveChanged.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void askYtMusic((ytMusic) => ytMusic.session).then((result) => {
        if (current && Result.isSuccess(result)) setYt(result.success);
      });
      void WaveAccount.session().then(
        (session) => {
          if (current) setWave(session);
        },
        () => {},
      );
      return () => {
        current = false;
      };
    }, []),
  );

  return accountsSummary(yt, wave);
};

/**
 * Each Settings row's line on its page, live: a rescan or the whole-Library
 * lookup while it runs, how many music folders there are, how many songs are
 * downloading and waiting and how many songs' downloads failed, the accounts
 * signed into. Null leaves a row with its title alone.
 */
export const useSettingsSummaries = (): Record<SettingsPage, string | null> => {
  const roots = useScanRoots();
  const scanning = useScanState().status === "scanning";
  const lookup = useLibraryLookup();
  const accounts = useAccountsSummary();
  const failedDownloads = useFailedDownloads().length;
  const queuedDownloads = useQueuedDownloads();
  return {
    library: scanning
      ? "Scanning…"
      : roots.length === 0
        ? null
        : counted(roots.length, "music folder"),
    appearance: null,
    playback: null,
    lyricsAndTags:
      lookup.status === "running" ? libraryLookupProgress(lookup.done, lookup.total).line : null,
    downloads: downloadsSummary(failedDownloads, queuedDownloads),
    accounts,
    developer: null,
  };
};
