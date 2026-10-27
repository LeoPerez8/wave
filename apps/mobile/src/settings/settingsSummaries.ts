import {
  accountsSummary,
  counted,
  downloadsSummary,
  libraryLookupProgress,
  type SettingsPage,
  type SpotifySession,
  type WaveSession,
  type YtSession,
} from "@wave/core";
import * as Result from "effect/Result";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { useLibraryLookup } from "@/library/findLyricsAndGenre";
import { useScanRoots, useScanStatus } from "@/library/hooks";
import { WaveAccount } from "@/native/waveAccount";
import { WaveSpotify } from "@/native/waveSpotify";
import { WaveYtMusic } from "@/native/waveYtMusic";
import { askSpotify } from "@/spotify/askSpotify";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { useDownloadCounts } from "@/ytmusic/YtDownloads";

import { useSwipeSettings } from "./swipeActions";

/**
 * The accounts this phone is signed into (Core's `accountsSummary`), from the
 * sessions the native modules hold, without asking YouTube or Wave's server.
 * Read again each time Settings shows, so a sign-in on Accounts is there on
 * the way back.
 */
const useAccountsSummary = (): string | null => {
  const [yt, setYt] = useState<YtSession>({ status: "signedOut" });
  const [wave, setWave] = useState<WaveSession>({ status: "signedOut" });
  const [spotify, setSpotify] = useState<SpotifySession>({ status: "signedOut" });

  useEffect(() => {
    const ytChanged = WaveYtMusic.addListener("onSessionChanged", setYt);
    const waveChanged = WaveAccount.addListener("onSessionChanged", setWave);
    const spotifyChanged = WaveSpotify.addListener("onSessionChanged", setSpotify);
    return () => {
      ytChanged.remove();
      waveChanged.remove();
      spotifyChanged.remove();
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
      void askSpotify((account) => account.session).then((result) => {
        if (current && Result.isSuccess(result)) setSpotify(result.success);
      });
      return () => {
        current = false;
      };
    }, []),
  );

  return accountsSummary(yt, wave, spotify);
};

/**
 * Each Settings row's line on its page, live: a rescan or the whole-Library
 * lookup while it runs, how many music folders there are, how many songs are
 * downloading and waiting and how many songs' downloads failed, the accounts
 * signed into. Null leaves a row with its title alone.
 */
export const useSettingsSummaries = (): Record<SettingsPage, string | null> => {
  const roots = useScanRoots();
  const scanning = useScanStatus() === "scanning";
  const lookup = useLibraryLookup();
  const accounts = useAccountsSummary();
  // Counts only: building the failed or queued lists here froze Settings with hundreds of songs.
  const downloads = useDownloadCounts();
  const swipes = useSwipeSettings().enabled;
  return {
    library: scanning
      ? "Scanning…"
      : roots.length === 0
        ? null
        : counted(roots.length, "music folder"),
    appearance: null,
    layout: null,
    swipeActions: swipes ? null : "Off",
    playback: null,
    history: null,
    lyricsAndTags:
      lookup.status === "running" ? libraryLookupProgress(lookup.done, lookup.total).line : null,
    downloads: downloadsSummary(downloads.failed, downloads.queued),
    accounts,
    developer: null,
  };
};
