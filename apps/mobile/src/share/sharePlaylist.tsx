import { useLocalisation, currentLocalisation } from "@/localisation/localisation";
/**
 * Sharing a playlist on YT Music or Spotify (docs/spec.md, "Sharing
 * playlists"): its menu's Share opens a card of services; each makes a
 * playlist anyone with its link can open on the signed-in account (unlisted
 * on YT Music, public on Spotify) with the songs it matches (Core's
 * `matchSharedSongs`, `spotifyShareSong`; YT Music's side, which Export to
 * YT Music shares, is `ytSharedPlaylists.ts`), or brings the one it made
 * before up to date (`syncSharedPlaylist`, through each service's
 * `SharedPlaylistService`; a private one Export made turns unlisted), then
 * opens Android's share sheet with its link and says how many songs were
 * found.
 */
import {
  entryDivider,
  librarySearchSong,
  matchSharedSongs,
  PLAYLIST_SHARE_LABELS,
  playlistShareServices,
  readSpotifySharedPlaylist,
  sharePlaylistFailureLine,
  shareSignInAlert,
  sharedEditBatches,
  sharedSongsLine,
  spotifyLibraryHas,
  spotifyPlaylistUrl,
  spotifySearchQuery,
  spotifyShareMatch,
  spotifyShareSong,
  syncSharedPlaylist,
  ytMusicPlaylistUrl,
  type PlaylistShareService,
  type SharedPlaylistService,
  type SharedSongs,
  type SharePlaylistFailure,
  type SpotifyShareItem,
  type SpotifySong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { Share, Text } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { LibraryStore } from "@/library/LibraryStore";
import type { NamedPlaylist } from "@/library/PlaylistSheets";
import { appRuntime } from "@/library/runtime";
import { pressedRect } from "@/motion/pressedRect";
import { confirmAction, showError, showMessage } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { followUp, openOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { signInToSpotify, spotifySignedIn } from "@/settings/spotifyAccount";
import { signInToYtMusic, ytMusicSignedIn } from "@/settings/ytAccount";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { askSpotifyOrFail } from "@/spotify/askSpotify";
import type { Spotify } from "@/spotify/Spotify";
import { SpotifyError } from "@/spotify/SpotifyError";

import {
  matchOnYtMusic,
  rememberedSharedPlaylist,
  SearchFailed,
  ytMusicFailure,
  ytMusicPlaylists,
} from "./ytSharedPlaylists";

/** The Wave playlist [id]'s songs matched on YT Music (none once it's deleted). */
const matchOnYt = async (id: number): Promise<SharedSongs> =>
  (await matchOnYtMusic(id))?.songs ?? { ids: [], found: 0, total: 0 };

// ---------------------------------------------------------------------------
// Spotify

/** The playlist [id]'s entries as sharing on Spotify sees them. */
const readSpotifyShareItems = (id: number) =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) =>
    Effect.map(store.getPlaylist(id, "library"), (detail) =>
      (detail?.items ?? []).map((item): SpotifyShareItem =>
        item.source === "library"
          ? { source: "library", song: librarySearchSong(item.track) }
          : item,
      ),
    ),
  );

/** One Spotify search for [song]'s title and artists, and the track that is the same recording. */
const searchSpotifyTrack = async (song: SpotifySong): Promise<string | null> => {
  const data = await askSpotifyOrFail((spotify) => spotify.searchTracks(spotifySearchQuery(song)));
  const uri = spotifyShareMatch(song, data);
  if (uri === undefined) throw new SearchFailed();
  return uri;
};

/** The playlist [id]'s songs matched on Spotify, each searched with Spotify's own search. */
const matchOnSpotify = async (id: number): Promise<SharedSongs> => {
  const items = await appRuntime.runPromise(readSpotifyShareItems(id));
  return matchSharedSongs(items.map(spotifyShareSong), searchSpotifyTrack);
};

/** [read] (Core reading Spotify's pages), an answer it can't read failing as Spotify's does. */
const readSpotify = <A,>(read: () => Promise<A>): Promise<A> =>
  read().catch((error: unknown) => {
    throw error instanceof SpotifyError ? error : new SpotifyError({ reason: "failed" });
  });

/** [use]'s answer from Spotify, one request's worth of [items] at a time. */
const inBatches = async <T,>(
  items: readonly T[],
  use: (spotify: Spotify["Service"], batch: readonly T[]) => Effect.Effect<void, SpotifyError>,
): Promise<void> => {
  for (const batch of sharedEditBatches(items))
    await askSpotifyOrFail((spotify) => use(spotify, batch));
};

/**
 * The account's Spotify playlists, as sharing the Wave playlist [id] changes
 * them: one deleted on Spotify is out of the account's library (or no
 * longer the account's to edit), and each update makes it open to anyone
 * with its link again.
 */
const spotifyPlaylists = (id: number): SharedPlaylistService => ({
  ...rememberedSharedPlaylist("spotify", id),
  holds: (uri) =>
    readSpotify(() =>
      spotifyLibraryHas(uri, (offset) => askSpotifyOrFail((spotify) => spotify.library(offset))),
    ),
  read: (uri) =>
    readSpotify(() =>
      readSpotifySharedPlaylist((offset) =>
        askSpotifyOrFail((spotify) => spotify.playlist(uri, offset)),
      ),
    ),
  change: async (uri, { name, removes, adds }) => {
    await askSpotifyOrFail((spotify) => spotify.renamePlaylist(uri, name));
    await askSpotifyOrFail((spotify) => spotify.makePlaylistPublic(uri));
    await inBatches(removes, (spotify, batch) =>
      spotify.removeFromPlaylist(
        uri,
        batch.map(({ entryId }) => entryId),
      ),
    );
    await inBatches(adds, (spotify, batch) => spotify.addToPlaylist(uri, batch));
  },
  move: async (uri, moves) => {
    for (const { entryId, before } of moves)
      await askSpotifyOrFail((spotify) => spotify.movePlaylistEntry(uri, entryId, before));
  },
  // A public playlist: Spotify's private ones don't open for anyone else.
  create: async (name, ids) => {
    const uri = await askSpotifyOrFail((spotify) => spotify.createPlaylist(name));
    await inBatches(ids, (spotify, batch) => spotify.addToPlaylist(uri, batch));
    return uri;
  },
});

/** Why sharing on Spotify stopped, from its reason. */
const spotifyFailure = (error: unknown): SharePlaylistFailure | null =>
  error instanceof SpotifyError ? error.reason : null;

// ---------------------------------------------------------------------------
// Sharing

/** What sharing does differently on each service. */
interface ShareTarget {
  /** Whether the account is signed in, as saved. */
  readonly signedIn: () => Promise<boolean>;
  /** The service's sign-in (the one its Settings uses); true once signed in. */
  readonly signIn: () => Promise<boolean>;
  /** The Wave playlist [id]'s songs, matched on the service. */
  readonly match: (id: number) => Promise<SharedSongs>;
  /** The account's playlists, as sharing the Wave playlist [id] changes them. */
  readonly playlists: (id: number) => SharedPlaylistService;
  readonly url: (playlistId: string) => string;
  /** Why sharing stopped, from what the service failed with; null for anything else. */
  readonly failure: (error: unknown) => SharePlaylistFailure | null;
}

const TARGETS: Record<PlaylistShareService, ShareTarget> = {
  ytMusic: {
    signedIn: ytMusicSignedIn,
    signIn: signInToYtMusic,
    match: matchOnYt,
    playlists: (id) => ytMusicPlaylists(id, "share"),
    url: ytMusicPlaylistUrl,
    failure: ytMusicFailure,
  },
  spotify: {
    signedIn: spotifySignedIn,
    signIn: signInToSpotify,
    match: matchOnSpotify,
    playlists: spotifyPlaylists,
    url: spotifyPlaylistUrl,
    failure: spotifyFailure,
  },
};

/** Whether [service] has the account's session; signed out, asks to sign in first. */
const ensureSignedIn = async (service: PlaylistShareService): Promise<boolean> => {
  const { signedIn, signIn } = TARGETS[service];
  if (await signedIn()) return true;
  if (!(await confirmAction(shareSignInAlert(service, currentLocalisation().strings)))) {
    return false;
  }
  return signIn();
};

/** Why sharing on [service] stopped, as its message says it (Core's `sharePlaylistFailureLine`). */
const failureMessage = (service: PlaylistShareService, error: unknown): string => {
  const failure =
    error instanceof SearchFailed ? "noSearchAnswer" : TARGETS[service].failure(error);
  if (failure !== null) {
    return sharePlaylistFailureLine(service, failure, currentLocalisation().strings);
  }
  return error instanceof Error ? error.message : String(error);
};

/**
 * Shares [playlist] on [service]: signed in (asked first when not), it
 * matches its songs there, makes or updates the account's copy, opens the
 * share sheet with its link and says how many songs were found.
 */
const sharePlaylistOn = async (
  service: PlaylistShareService,
  playlist: NamedPlaylist,
): Promise<void> => {
  if (!(await ensureSignedIn(service))) return;
  const target = TARGETS[service];
  const { strings } = currentLocalisation();
  void showToast(strings.share.sharing(playlist.name, PLAYLIST_SHARE_LABELS[service]));
  try {
    const shared = await target.match(playlist.id);
    if (shared.ids.length === 0) {
      await showMessage(strings.share.nothingToShare, strings.share.nothingFound[service]);
      return;
    }
    const playlistId = await syncSharedPlaylist(
      target.playlists(playlist.id),
      playlist.name,
      shared.ids,
    );
    void showToast(sharedSongsLine(shared, strings));
    await Share.share({ message: target.url(playlistId), title: playlist.name });
  } catch (error) {
    await showError(strings.share.shareFailed, new Error(failureMessage(service, error)));
  }
};

/** The Share card: one entry per service, each handed to [choose]. */
function ShareMenu({
  services,
  choose,
}: {
  services: readonly PlaylistShareService[];
  choose: (service: PlaylistShareService) => void;
}) {
  const { strings } = useLocalisation();
  const flow = useOverlayFlow();
  return (
    <>
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        {strings.share.share}
      </Text>
      <Hairline />
      <CardEntries>
        {services.map((service, index) => (
          <EntryRow
            key={service}
            label={PLAYLIST_SHARE_LABELS[service]}
            divider={entryDivider(index, services.length, flow)}
            onPress={() => choose(service)}
          />
        ))}
      </CardEntries>
    </>
  );
}

/**
 * A playlist menu's Share: a card of the services it can be shared on (YT
 * Music while it's on, and Spotify), next to the entry pressed; choosing one
 * shares it.
 */
export const openSharePlaylist = (playlist: NamedPlaylist): void => {
  const services = playlistShareServices({ ytMusic: ytMusicEnabled() });
  openOverlay({
    label: currentLocalisation().strings.share.share,
    anchor: pressedRect(),
    render: (close) => (
      <ShareMenu
        services={services}
        choose={(service) => {
          close();
          void followUp(() => sharePlaylistOn(service, playlist));
        }}
      />
    ),
  });
};
