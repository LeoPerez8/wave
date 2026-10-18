/**
 * Sharing a playlist on YT Music or Spotify (docs/spec.md, "Sharing
 * playlists"): its menu's Share opens a card of services; each makes a
 * playlist anyone with its link can open on the signed-in account (unlisted
 * on YT Music, public on Spotify) with the songs it matches (Core's
 * `matchSharedSongs`, `ytShareSong`, `spotifyShareSong`), or brings the one
 * it made before up to date (`sharedPlaylistChanges`, `sharedPlaylistMoves`),
 * then opens Android's share sheet with its link and says how many songs
 * were found.
 */
import {
  entryDivider,
  matchSharedSongs,
  PLAYLIST_SHARE_LABELS,
  playlistShareServices,
  readSpotifySharedPlaylist,
  shareSignInAlert,
  sharedEditBatches,
  sharedPlaylistChanges,
  sharedPlaylistMoves,
  sharedSongsLine,
  spotifyLibraryHas,
  spotifyPlaylistUrl,
  spotifySearchQuery,
  spotifyShareMatch,
  spotifyShareSong,
  ytMusicPlaylistUrl,
  ytShareMatch,
  ytShareSong,
  type PlaylistShareService,
  type SharedEntry,
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
import { confirmAction, showError, showMessage } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { followUp, openOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { ytMusicEnabled } from "@/settings/ytMusic";
import {
  WaveSpotify,
  spotifyErrorCode,
  spotifySignInFailure,
  type SpotifyErrorCode,
} from "@/native/waveSpotify";
import type { NativeYtPlaylistEdit } from "@/native/waveYtMusic";
import { askYtMusic, searchSongsInTurn } from "@/ytmusic/askYtMusic";
import { YtLibraryError, YtMusic } from "@/ytmusic/YtMusic";

/** Where the YT Music playlist made for the Wave playlist [id] is remembered (this phone only). */
const sharedKey = (id: number): string => `share.ytMusic.${id}`;

/** A search that got no answer: sharing stops rather than leave songs out for it. */
class SearchFailed extends Error {}

/** [item] as sharing on YT Music sees it, with the video ids the Library's songs were downloaded from. */
const shareItem = (item: PlaylistEntryRow, videoIds: ReadonlyMap<number, string>): YtShareItem => {
  if (item.source !== "library") return item;
  const { id, title, artist, album, durationMs } = item.track;
  return {
    source: "library",
    videoId: videoIds.get(id) ?? null,
    song: { title, artists: [artist], album, durationMs },
  };
};

/** The playlist [id]'s entries and the video ids of its Library songs. */
const readPlaylist = (id: number) =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) =>
    Effect.gen(function* () {
      const detail = yield* store.getPlaylist(id, "library");
      const items = detail?.items ?? [];
      const trackIds = items.flatMap((item) => (item.source === "library" ? [item.track.id] : []));
      const videoIds = yield* store.videoIds(trackIds);
      return items.map((item) => shareItem(item, videoIds));
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

const entriesOf = (
  entries: readonly { readonly videoId: string; readonly setVideoId: string }[],
): SharedEntry[] =>
  entries.map(({ videoId, setVideoId }) => ({ id: videoId, entryId: setVideoId }));

/**
 * Makes the account's playlist [playlistId] (made by sharing before) hold
 * [ids] in order under [name]; false when it's gone (deleted on YouTube
 * Music, or another account's).
 */
const updateShared = async (
  playlistId: string,
  name: string,
  ids: readonly string[],
): Promise<boolean> => {
  const before = await ask((ytMusic) => ytMusic.ownPlaylist(playlistId));
  if (before === null) return false;
  const { removes, adds } = sharedPlaylistChanges(entriesOf(before), ids);
  await edit(playlistId, [
    { kind: "rename", title: name },
    ...removes.map(
      ({ id, entryId }) => ({ kind: "remove", videoId: id, setVideoId: entryId }) as const,
    ),
    ...adds.map((videoId) => ({ kind: "add", videoId }) as const),
  ]);
  // Added songs go at the end, and only YouTube knows their entries: read it again to order them.
  const after =
    removes.length + adds.length === 0
      ? before
      : await ask((ytMusic) => ytMusic.ownPlaylist(playlistId));
  if (after === null) return false;
  const moves = sharedPlaylistMoves(entriesOf(after), ids);
  await edit(
    playlistId,
    moves.map(({ entryId, before: next }) => ({ kind: "move", setVideoId: entryId, before: next })),
  );
  return true;
};

/** Makes an unlisted playlist [name] on the account holding [ids] in order: its id. */
const createShared = async (name: string, ids: readonly string[]): Promise<string> => {
  const [first = [], ...rest] = sharedEditBatches(ids);
  const playlistId = await ask((ytMusic) => ytMusic.createPlaylist(name, first));
  await edit(
    playlistId,
    rest.flat().map((videoId) => ({ kind: "add", videoId }) as const),
  );
  return playlistId;
};

/** Whether YT Music has the account's session; signed out, asks to sign in first. */
const ensureSignedIn = async (): Promise<boolean> => {
  const session = await askYtMusic((ytMusic) => ytMusic.session);
  if (Result.isSuccess(session) && session.success.status === "signedIn") return true;
  if (!(await confirmAction(shareSignInAlert("ytMusic")))) return false;
  const signedIn = await askYtMusic((ytMusic) => ytMusic.signIn);
  if (Result.isFailure(signedIn)) {
    void showMessage(
      "Couldn't sign in",
      signedIn.failure.reason === "offline"
        ? "Couldn't sign in without a connection."
        : "YouTube didn't confirm the sign-in. Try again.",
    );
    return false;
  }
  return signedIn.success?.status === "signedIn";
};

/** Why sharing stopped, as its message says it. */
const failureMessage = (error: unknown): string => {
  if (error instanceof SearchFailed) return "YouTube Music didn't answer a search. Try again.";
  if (error instanceof YtLibraryError)
    return error.reason === "offline"
      ? "Sharing needs a connection."
      : error.reason === "signedOut"
        ? "YouTube Music signed you out. Sign in and share again."
        : "YouTube Music didn't take the playlist. Try again.";
  return error instanceof Error ? error.message : String(error);
};

/**
 * Shares [playlist] on YT Music: signed in (asked first when not), it makes
 * or updates the account's unlisted copy, opens the share sheet with its
 * link and says how many songs were found.
 */
const shareOnYtMusic = async (playlist: NamedPlaylist): Promise<void> => {
  if (!(await ensureSignedIn())) return;
  void showToast(`Sharing ${playlist.name} on YT Music…`);
  try {
    const items = await appRuntime.runPromise(readPlaylist(playlist.id));
    // An unsearched entry is searched by its own song (`ytShareSong`), so it's told apart by identity.
    const unsearched = new Set<SpotifySong>(
      items.flatMap((item) => (item.source === "unsearched" ? [item.song] : [])),
    );
    const shared = await matchSharedSongs(items.map(ytShareSong), (song) =>
      searchVideoId(song, unsearched.has(song)),
    );
    if (shared.ids.length === 0) {
      await showMessage("Nothing to share", "None of the playlist's songs are on YouTube Music.");
      return;
    }
    const remembered = await Storage.getItem(sharedKey(playlist.id));
    let playlistId = remembered;
    if (playlistId === null || !(await updateShared(playlistId, playlist.name, shared.ids)))
      playlistId = await createShared(playlist.name, shared.ids);
    if (playlistId !== remembered) await Storage.setItem(sharedKey(playlist.id), playlistId);
    void showToast(sharedSongsLine(shared));
    await Share.share({ message: ytMusicPlaylistUrl(playlistId), title: playlist.name });
  } catch (error) {
    await showError("Couldn't share the playlist", new Error(failureMessage(error)));
  }
};

// ---------------------------------------------------------------------------
// Spotify

/** Where the Spotify playlist made for the Wave playlist [id] is remembered (this phone only). */
const spotifySharedKey = (id: number): string => `share.spotify.${id}`;

/** A Spotify request that failed, with the native module's reason. */
class SpotifyShareError extends Error {
  constructor(readonly code: SpotifyErrorCode) {
    super(code);
  }
}

/** Runs the Spotify request [send], failing with a `SpotifyShareError`. */
const spotify = async <A,>(send: () => Promise<A>): Promise<A> => {
  try {
    return await send();
  } catch (error) {
    throw new SpotifyShareError(spotifyErrorCode(error));
  }
};

/** The answer data a read resolved, as JSON. */
const parsed = async (read: Promise<string>): Promise<unknown> => JSON.parse(await read) as unknown;

/** The playlist [id]'s entries as sharing on Spotify sees them. */
const readSpotifyItems = (id: number) =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) =>
    Effect.map(store.getPlaylist(id, "library"), (detail) =>
      (detail?.items ?? []).map((item): SpotifyShareItem => {
        if (item.source !== "library") return item;
        const { title, artist, album, durationMs } = item.track;
        return { source: "library", song: { title, artists: [artist], album, durationMs } };
      }),
    ),
  );

/** One Spotify search for [song]'s title and artists, and the track that is the same recording. */
const searchSpotifyTrack = async (song: SpotifySong): Promise<string | null> => {
  const data = await spotify(() => parsed(WaveSpotify.searchTracks(spotifySearchQuery(song))));
  const uri = spotifyShareMatch(song, data);
  if (uri === undefined) throw new SearchFailed();
  return uri;
};

/** The account's Spotify playlist [uri]'s entries, read back; null when it's gone. */
const readSpotifyEntries = (uri: string) =>
  spotify(() =>
    readSpotifySharedPlaylist((offset) => parsed(WaveSpotify.playlistPage(uri, offset))),
  );

/** Adds [ids] at the end of the Spotify playlist [uri], a request's worth at a time. */
const addSpotifyTracks = async (uri: string, ids: readonly string[]): Promise<void> => {
  for (const batch of sharedEditBatches(ids))
    await spotify(() => WaveSpotify.addToPlaylist(uri, batch));
};

/**
 * Makes the account's Spotify playlist [uri] (made by sharing before) hold
 * [ids] in order under [name], open to anyone with its link; false when it's
 * gone (deleted on Spotify, so out of the account's library, or not the
 * account's to edit).
 */
const updateSpotifyShared = async (
  uri: string,
  name: string,
  ids: readonly string[],
): Promise<boolean> => {
  const inLibrary = await spotify(() =>
    spotifyLibraryHas(uri, (offset) => parsed(WaveSpotify.libraryPage(offset))),
  );
  if (!inLibrary) return false;
  const before = await readSpotifyEntries(uri);
  if (before === null) return false;
  await spotify(() => WaveSpotify.renamePlaylist(uri, name));
  await spotify(() => WaveSpotify.makePlaylistPublic(uri));
  const { removes, adds } = sharedPlaylistChanges(before, ids);
  for (const batch of sharedEditBatches(removes))
    await spotify(() =>
      WaveSpotify.removeFromPlaylist(
        uri,
        batch.map(({ entryId }) => entryId),
      ),
    );
  await addSpotifyTracks(uri, adds);
  // Added songs go at the end, and only Spotify knows their uids: read it again to order them.
  const after = removes.length + adds.length === 0 ? before : await readSpotifyEntries(uri);
  if (after === null) return false;
  for (const { entryId, before: next } of sharedPlaylistMoves(after, ids))
    await spotify(() => WaveSpotify.movePlaylistEntry(uri, entryId, next));
  return true;
};

/** Makes a public playlist [name] on the account holding [ids] in order: its URI. */
const createSpotifyShared = async (name: string, ids: readonly string[]): Promise<string> => {
  const uri = await spotify(() => WaveSpotify.createPlaylist(name));
  await addSpotifyTracks(uri, ids);
  return uri;
};

/** Whether Wave has the Spotify account's session; signed out, asks to sign in first. */
const ensureSpotifySignedIn = async (): Promise<boolean> => {
  const session = await WaveSpotify.session().catch(() => null);
  if (session?.status === "signedIn") return true;
  if (!(await confirmAction(shareSignInAlert("spotify")))) return false;
  try {
    const signedIn = await WaveSpotify.signIn();
    return signedIn?.status === "signedIn";
  } catch (error) {
    const failure = spotifySignInFailure(error);
    void showMessage(
      "Couldn't sign in",
      failure === "offline"
        ? "Couldn't sign in without a connection."
        : failure === "changed"
          ? "Spotify changed something. Try again after updating Wave."
          : "Spotify didn't confirm the sign-in. Try again.",
    );
    return false;
  }
};

/** Why sharing on Spotify stopped, as its message says it. */
const spotifyFailureMessage = (error: unknown): string => {
  if (error instanceof SearchFailed) return "Spotify didn't answer a search. Try again.";
  if (error instanceof SpotifyShareError)
    switch (error.code) {
      case "ERR_SPOTIFY_OFFLINE":
        return "Sharing needs a connection.";
      case "ERR_SPOTIFY_SIGNED_OUT":
        return "Spotify signed you out. Sign in and share again.";
      case "ERR_SPOTIFY_CHANGED":
        return "Spotify changed something. Try again after updating Wave.";
      case "ERR_SPOTIFY_FAILED":
        return "Spotify didn't take the playlist. Try again.";
    }
  return error instanceof Error ? error.message : String(error);
};

/**
 * Shares [playlist] on Spotify: signed in (asked first when not), it
 * searches each song with Spotify's search, makes or updates the account's
 * public copy, opens the share sheet with its link and says how many songs
 * were found.
 */
const shareOnSpotify = async (playlist: NamedPlaylist): Promise<void> => {
  if (!(await ensureSpotifySignedIn())) return;
  void showToast(`Sharing ${playlist.name} on Spotify…`);
  try {
    const items = await appRuntime.runPromise(readSpotifyItems(playlist.id));
    const shared = await matchSharedSongs(items.map(spotifyShareSong), searchSpotifyTrack);
    if (shared.ids.length === 0) {
      await showMessage("Nothing to share", "None of the playlist's songs are on Spotify.");
      return;
    }
    const remembered = await Storage.getItem(spotifySharedKey(playlist.id));
    let uri = remembered;
    if (uri === null || !(await updateSpotifyShared(uri, playlist.name, shared.ids)))
      uri = await createSpotifyShared(playlist.name, shared.ids);
    if (uri !== remembered) await Storage.setItem(spotifySharedKey(playlist.id), uri);
    void showToast(sharedSongsLine(shared));
    await Share.share({ message: spotifyPlaylistUrl(uri), title: playlist.name });
  } catch (error) {
    await showError("Couldn't share the playlist", new Error(spotifyFailureMessage(error)));
  }
};

const SHARE_ON: Record<PlaylistShareService, (playlist: NamedPlaylist) => Promise<void>> = {
  ytMusic: shareOnYtMusic,
  spotify: shareOnSpotify,
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
  if (services.length === 0) return;
  openOverlay({
    label: "Share",
    anchor: pressedRect(),
    render: (close) => (
      <ShareMenu
        services={services}
        choose={(service) => {
          close();
          void followUp(() => SHARE_ON[service](playlist));
        }}
      />
    ),
  });
};
