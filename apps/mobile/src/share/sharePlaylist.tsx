/**
 * Sharing a playlist on YT Music or Spotify (docs/spec.md, "Sharing
 * playlists"): its menu's Share opens a card of services; each makes a
 * playlist anyone with its link can open on the signed-in account (unlisted
 * on YT Music, public on Spotify) with the songs it matches (Core's
 * `matchSharedSongs`, `ytShareSong`, `spotifyShareSong`), or brings the one
 * it made before up to date (`syncSharedPlaylist`, through each service's
 * `SharedPlaylistService`), then opens Android's share sheet with its link
 * and says how many songs were found.
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
  ytShareMatch,
  ytShareSong,
  type PlaylistShareService,
  type SharedPlaylistService,
  type SharedSongs,
  type SharePlaylistFailure,
  type SpotifyShareItem,
  type SpotifySong,
  type YtShareItem,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { Storage } from "expo-sqlite/kv-store";
import { Share, Text } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { LibraryStore, type PlaylistEntryRow } from "@/library/LibraryStore";
import type { NamedPlaylist } from "@/library/PlaylistSheets";
import { appRuntime } from "@/library/runtime";
import { settleUnsearchedSong } from "@/library/unsearchedEntries";
import { pressedRect } from "@/motion/pressedRect";
import type { NativeYtPlaylistEdit } from "@/native/waveYtMusic";
import { confirmAction, showError, showMessage } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { followUp, openOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { signInToSpotify, spotifySignedIn } from "@/settings/spotifyAccount";
import { signInToYtMusic, ytMusicSignedIn } from "@/settings/ytAccount";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { askSpotifyOrFail } from "@/spotify/askSpotify";
import { SpotifyError, type Spotify } from "@/spotify/Spotify";
import { askYtMusic, searchSongsInTurn } from "@/ytmusic/askYtMusic";
import { YtLibraryError, YtMusic } from "@/ytmusic/YtMusic";

/** A search that got no answer: sharing stops rather than leave songs out for it. */
class SearchFailed extends Error {}

/**
 * Where the [service] playlist made for the Wave playlist [id] is remembered
 * (this phone only), read and written as Core's `syncSharedPlaylist` asks.
 */
const remembered = (
  service: PlaylistShareService,
  id: number,
): Pick<SharedPlaylistService, "recall" | "remember"> => {
  const key = `share.${service}.${id}`;
  return {
    recall: () => Storage.getItem(key),
    remember: (playlistId) => Storage.setItem(key, playlistId),
  };
};

// ---------------------------------------------------------------------------
// YT Music

/** [item] as sharing on YT Music sees it, with the video ids the Library's songs were downloaded from. */
const ytShareItem = (item: PlaylistEntryRow, videoIds: ReadonlyMap<number, string>): YtShareItem =>
  item.source === "library"
    ? {
        source: "library",
        videoId: videoIds.get(item.track.id) ?? null,
        song: librarySearchSong(item.track),
      }
    : item;

/** The playlist [id]'s entries and the video ids of its Library songs. */
const readYtShareItems = (id: number) =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) =>
    Effect.gen(function* () {
      const detail = yield* store.getPlaylist(id, "library");
      const items = detail?.items ?? [];
      const trackIds = items.flatMap((item) => (item.source === "library" ? [item.track.id] : []));
      const videoIds = yield* store.videoIds(trackIds);
      return items.map((item) => ytShareItem(item, videoIds));
    }),
  );

/**
 * One YouTube Music Songs search for [song] in the shared allowance (as
 * Share), and the video id of the result that is the same recording. An
 * unsearched entry searched this way is settled in its playlists too, as
 * playing it would.
 */
const searchVideoId = async (song: SpotifySong, unsearched: boolean): Promise<string | null> => {
  const answer = await searchSongsInTurn("share", spotifySearchQuery(song));
  if (answer === null || !answer.ok) throw new SearchFailed();
  if (unsearched) {
    const settled = await settleUnsearchedSong(
      { ...song, artworkUrl: song.artworkUrl ?? null },
      answer,
    );
    return settled.kind === "found" ? settled.becomes.song.videoId : null;
  }
  return ytShareMatch(song, answer.songs);
};

/** The playlist [id]'s songs matched on YT Music. */
const matchOnYtMusic = async (id: number): Promise<SharedSongs> => {
  const items = await appRuntime.runPromise(readYtShareItems(id));
  // An unsearched entry is searched by its own song (`ytShareSong`), so it's told apart by identity.
  const unsearched = new Set<SpotifySong>(
    items.flatMap((item) => (item.source === "unsearched" ? [item.song] : [])),
  );
  return matchSharedSongs(items.map(ytShareSong), (song) =>
    searchVideoId(song, unsearched.has(song)),
  );
};

/** Runs [use] on YT Music, failing with its reason. */
const ask = async <A,>(
  use: (ytMusic: YtMusic["Service"]) => Effect.Effect<A, YtLibraryError>,
): Promise<A> => {
  const result = await askYtMusic(use);
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
};

/** Applies [edits] to the account's playlist [playlistId], a request's worth at a time. */
const edit = async (playlistId: string, edits: readonly NativeYtPlaylistEdit[]): Promise<void> => {
  for (const batch of sharedEditBatches(edits))
    await ask((ytMusic) => ytMusic.editPlaylist(playlistId, batch));
};

/** The account's YT Music playlists, as sharing the Wave playlist [id] changes them. */
const ytMusicPlaylists = (id: number): SharedPlaylistService => ({
  ...remembered("ytMusic", id),
  read: async (playlistId) => {
    const entries = await ask((ytMusic) => ytMusic.ownPlaylist(playlistId));
    return (
      entries?.map(({ videoId, setVideoId }) => ({ id: videoId, entryId: setVideoId })) ?? null
    );
  },
  change: (playlistId, { name, removes, adds }) =>
    edit(playlistId, [
      { kind: "rename", title: name },
      ...removes.map(
        ({ id: videoId, entryId }) => ({ kind: "remove", videoId, setVideoId: entryId }) as const,
      ),
      ...adds.map((videoId) => ({ kind: "add", videoId }) as const),
    ]),
  move: (playlistId, moves) =>
    edit(
      playlistId,
      moves.map(({ entryId, before }) => ({ kind: "move", setVideoId: entryId, before }) as const),
    ),
  // An unlisted playlist, made with its first request's worth and filled with the rest.
  create: async (name, ids) => {
    const [first = [], ...rest] = sharedEditBatches(ids);
    const playlistId = await ask((ytMusic) => ytMusic.createPlaylist(name, first));
    await edit(
      playlistId,
      rest.flat().map((videoId) => ({ kind: "add", videoId }) as const),
    );
    return playlistId;
  },
});

/** Why sharing on YT Music stopped, from its reason. */
const ytMusicFailure = (error: unknown): SharePlaylistFailure | null =>
  error instanceof YtLibraryError
    ? error.reason === "offline" || error.reason === "signedOut"
      ? error.reason
      : "failed"
    : null;

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
  ...remembered("spotify", id),
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
  /** What sharing says when none of the songs are on the service. */
  readonly nothingFound: string;
  /** Why sharing stopped, from what the service failed with; null for anything else. */
  readonly failure: (error: unknown) => SharePlaylistFailure | null;
}

const TARGETS: Record<PlaylistShareService, ShareTarget> = {
  ytMusic: {
    signedIn: ytMusicSignedIn,
    signIn: signInToYtMusic,
    match: matchOnYtMusic,
    playlists: ytMusicPlaylists,
    url: ytMusicPlaylistUrl,
    nothingFound: "None of the playlist's songs are on YouTube Music.",
    failure: ytMusicFailure,
  },
  spotify: {
    signedIn: spotifySignedIn,
    signIn: signInToSpotify,
    match: matchOnSpotify,
    playlists: spotifyPlaylists,
    url: spotifyPlaylistUrl,
    nothingFound: "None of the playlist's songs are on Spotify.",
    failure: spotifyFailure,
  },
};

/** Whether [service] has the account's session; signed out, asks to sign in first. */
const ensureSignedIn = async (service: PlaylistShareService): Promise<boolean> => {
  const { signedIn, signIn } = TARGETS[service];
  if (await signedIn()) return true;
  if (!(await confirmAction(shareSignInAlert(service)))) return false;
  return signIn();
};

/** Why sharing on [service] stopped, as its message says it (Core's `sharePlaylistFailureLine`). */
const failureMessage = (service: PlaylistShareService, error: unknown): string => {
  const failure =
    error instanceof SearchFailed ? "noSearchAnswer" : TARGETS[service].failure(error);
  if (failure !== null) return sharePlaylistFailureLine(service, failure);
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
  void showToast(`Sharing ${playlist.name} on ${PLAYLIST_SHARE_LABELS[service]}…`);
  try {
    const shared = await target.match(playlist.id);
    if (shared.ids.length === 0) {
      await showMessage("Nothing to share", target.nothingFound);
      return;
    }
    const playlistId = await syncSharedPlaylist(
      target.playlists(playlist.id),
      playlist.name,
      shared.ids,
    );
    void showToast(sharedSongsLine(shared));
    await Share.share({ message: target.url(playlistId), title: playlist.name });
  } catch (error) {
    await showError("Couldn't share the playlist", new Error(failureMessage(service, error)));
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
  const flow = useOverlayFlow();
  return (
    <>
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        Share
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
    label: "Share",
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
