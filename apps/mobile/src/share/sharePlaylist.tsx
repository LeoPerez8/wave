/**
 * Sharing a playlist on YT Music (docs/spec.md, "Sharing playlists"): its
 * menu's Share opens a card of services; YT Music makes an unlisted playlist
 * on the signed-in account with the songs it matches (Core's
 * `matchSharedSongs`, `ytShareSong`), or brings the one it made before up to
 * date (`sharedPlaylistChanges`, `sharedPlaylistMoves`), then opens Android's
 * share sheet with its link and says how many songs were found.
 */
import {
  entryDivider,
  matchSharedSongs,
  PLAYLIST_SHARE_LABELS,
  playlistShareServices,
  shareSignInAlert,
  sharedEditBatches,
  sharedPlaylistChanges,
  sharedPlaylistMoves,
  sharedSongsLine,
  spotifySearchQuery,
  ytMusicPlaylistUrl,
  ytShareMatch,
  ytShareSong,
  type PlaylistShareService,
  type SharedEntry,
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

const SHARE_ON: Record<PlaylistShareService, (playlist: NamedPlaylist) => Promise<void>> = {
  ytMusic: shareOnYtMusic,
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
 * Music while it's on), next to the entry pressed; choosing one shares it.
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
