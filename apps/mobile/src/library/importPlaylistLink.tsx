import {
  entryDivider,
  findSpotifySongs,
  linkImportSummary,
  linkImportView,
  planLinkImport,
  planSpotifyImport,
  playlistImportSources,
  readSpotifyPlaylist,
  recognisePlaylistLink,
  sharedTextImport,
  spotifyShortLinkTarget,
  YT_MUSIC_OFF_NOTICE,
  type ImportNotice,
  type LinkImportPlan,
  type LinkImportRead,
  type LinkReadFailure,
  type PlaylistImportSource,
  type PlaylistLink,
  type SpotifyReadFailure,
  type SpotifyTransport,
  type YtSongSearch,
} from "@wave/core";
import * as Result from "effect/Result";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { WaveNative } from "@/native/waveNative";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { pressedRect } from "@/motion/pressedRect";
import { showError, showMessage } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { followUp, openOverlay, presentOverlay } from "@/overlay/overlay";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { useThemeColor } from "@/theme/useThemeColor";
import { askYtMusic } from "@/ytmusic/askYtMusic";

import { importPlaylists, saveImportedPlaylist, type ImportedPlaylist } from "./importPlaylists";
import { LibraryStore } from "./LibraryStore";
import { openPlaylist } from "./routes";
import { appRuntime } from "./runtime";

// ---------------------------------------------------------------------------
// Import service

/** A linked playlist read, or why it wasn't. */
export type LinkRead = LinkImportRead<NativeYtSong>;

const listLibrary = () => appRuntime.runPromise(LibraryStore.use((store) => store.listSongs));

/** Spotify through `fetch`, as Core's `readSpotifyPlaylist` asks; rejects when out of reach. */
const spotifyTransport =
  (signal: AbortSignal): SpotifyTransport =>
  async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ?? undefined,
      signal,
    });
    return { status: response.status, body: await response.text() };
  };

/** One YT Music Songs search, as Core's `findSpotifySongs` asks: the title and artists only. */
const searchYtSongs = async (query: string): Promise<YtSongSearch<NativeYtSong>> => {
  const answer = await askYtMusic((ytMusic) => ytMusic.searchSongs(query));
  return Result.isFailure(answer)
    ? { ok: false, reason: answer.failure.reason }
    : { ok: true, songs: answer.success.songs };
};

/**
 * The playlist a Spotify short link names, followed over the network (Core's
 * `spotifyShortLinkTarget`); a failure to show when it names none.
 */
const followShortLink = async (
  url: string,
  signal: AbortSignal,
): Promise<PlaylistLink | LinkReadFailure> => {
  try {
    const response = await fetch(url, { signal });
    const check = spotifyShortLinkTarget(response.url, await response.text());
    return check.ok ? check.link : check.problem === "song" ? "song" : "notPlaylist";
  } catch {
    return "unreachable";
  }
};

const SPOTIFY_FAILURES: Record<SpotifyReadFailure, LinkReadFailure> = {
  missing: "missing",
  unreachable: "unreachable",
  failed: "spotifyFailed",
};

/**
 * Reads a Spotify playlist (Core's `readSpotifyPlaylist`), then finds its
 * songs in the Library and on YouTube Music (`findSpotifySongs`), telling
 * [update] how far finding has got, and plans the import (`planSpotifyImport`).
 * Sends Spotify the playlist id, and YouTube Music one search per song the
 * Library doesn't have.
 */
const readSpotifyImport = async (
  playlistId: string,
  update: (read: LinkRead) => void,
  signal: AbortSignal,
): Promise<LinkRead> => {
  const read = await readSpotifyPlaylist(playlistId, spotifyTransport(signal), signal);
  if (!read.ok) return { status: "failed", reason: SPOTIFY_FAILURES[read.reason] };
  const { playlist } = read;
  const total = playlist.songs.length;
  update({ status: "finding", playlist, done: 0, total });
  const finding = await findSpotifySongs({
    songs: playlist.songs,
    library: await listLibrary(),
    search: searchYtSongs,
    onProgress: (done) => update({ status: "finding", playlist, done, total }),
    signal,
  });
  if (!finding.ok) {
    const { reason } = finding;
    return {
      status: "failed",
      reason: reason === "offline" || reason === "disabled" ? reason : "searchFailed",
    };
  }
  return { status: "read", playlist, plan: planSpotifyImport(playlist, finding.found) };
};

/**
 * Reads the playlist [link] names and plans its import against the Library.
 * A YouTube Music playlist is read whole (Core's `planLinkImport`), sending
 * YouTube Music the playlist id. A Spotify playlist is read from Spotify and
 * its songs found one by one, [update] hearing the progress; a short link is
 * followed first. Once [signal] is aborted nothing more is requested. Never
 * rejects: a failed read is `{ status: "failed" }`.
 */
export const readLinkImport = async (
  link: PlaylistLink,
  update: (read: LinkRead) => void,
  signal: AbortSignal,
): Promise<LinkRead> => {
  try {
    if (link.service === "spotifyShort") {
      const followed = await followShortLink(link.url, signal);
      if (typeof followed === "string") return { status: "failed", reason: followed };
      return await readLinkImport(followed, update, signal);
    }
    if (link.service === "spotify") return await readSpotifyImport(link.playlistId, update, signal);
    const answer = await askYtMusic((ytMusic) => ytMusic.playlist(link.playlistId));
    if (Result.isFailure(answer)) return { status: "failed", reason: answer.failure.reason };
    return {
      status: "read",
      playlist: answer.success,
      plan: planLinkImport(answer.success, await listLibrary()),
    };
  } catch {
    return { status: "failed", reason: "failed" };
  }
};

/**
 * Makes the planned playlist (Replace or Keep Both when its name is taken,
 * as the M3U import asks), opens it, and names the songs left out because
 * they weren't found (Core's `linkImportSummary`).
 */
export const saveLinkImport = async (
  plan: LinkImportPlan<NativeYtSong>,
): Promise<ImportedPlaylist> => {
  const saved = await saveImportedPlaylist(plan.name, plan.songs);
  openPlaylist(saved.playlistId);
  const summary = linkImportSummary({ ...plan, name: saved.name });
  if (summary !== null) void showSummary(summary);
  return saved;
};

// ---------------------------------------------------------------------------
// Entry points

/**
 * Opens the import card for a playlist link: [text] as pasted or shared (a
 * link, a link among words, or a bare playlist id; Core's
 * `recognisePlaylistLink`). The card reads the playlist at once and offers
 * Import and Cancel. Text that names no playlist opens the link card with it
 * filled in and the reason under it. With YT Music off it says so and asks
 * YouTube nothing.
 */
export const openLinkImport = (text: string): void => {
  if (!ytMusicEnabled()) {
    void showMessage(YT_MUSIC_OFF_NOTICE.title, YT_MUSIC_OFF_NOTICE.message);
    return;
  }
  const check = recognisePlaylistLink(text);
  if (check.ok) openImportCard(check.link);
  else void askForLink(text);
};

/**
 * Opens what [text] shared to Wave from another app names (Core's
 * `sharedTextImport`): the import card for its playlist, as From a Link opens
 * it, or a short message saying what Wave imports (or that YT Music is off).
 * Nothing is read for a message.
 */
export const openSharedText = (text: string): void => {
  const shared = sharedTextImport(text, { ytMusic: ytMusicEnabled() });
  if (shared.kind === "import") openImportCard(shared.link);
  else void showMessage(shared.title, shared.message);
};

/**
 * Library › Playlists › Import: From a Link or From Files (Core's
 * `playlistImportSources`). With YT Music off it opens the file picker at once.
 */
export const openPlaylistImport = (): void => {
  const sources = playlistImportSources({ ytMusic: ytMusicEnabled() });
  if (sources.length === 1) {
    void importPlaylists();
    return;
  }
  openOverlay({
    label: "Import",
    anchor: pressedRect(),
    render: (close) => (
      <SourceMenu
        sources={sources}
        choose={(source) => {
          close();
          if (source === "files") void importPlaylists();
          else void followUp(fromClipboard).then(askForLink);
        }}
      />
    ),
  });
};

const SOURCE_LABELS: Record<PlaylistImportSource, string> = {
  link: "From a Link",
  files: "From Files",
};

function SourceMenu({
  sources,
  choose,
}: {
  sources: readonly PlaylistImportSource[];
  choose: (source: PlaylistImportSource) => void;
}) {
  const flow = useOverlayFlow();
  return (
    <>
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        Import
      </Text>
      <Hairline />
      <CardEntries>
        {sources.map((source, index) => (
          <EntryRow
            key={source}
            label={SOURCE_LABELS[source]}
            divider={entryDivider(index, sources.length, flow)}
            onPress={() => choose(source)}
          />
        ))}
      </CardEntries>
    </>
  );
}

/** The clipboard's text when it names a playlist, to offer in the link card; "" otherwise. */
const fromClipboard = async (): Promise<string> => {
  try {
    const text = (await WaveNative.readClipboardText()) ?? "";
    return recognisePlaylistLink(text).ok ? text.trim() : "";
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------------------
// Link card: paste a link

/** Asks for a link, [initial] filled in; on Continue, opens the import card for it. */
const askForLink = async (initial: string): Promise<void> => {
  const link = await presentOverlay<PlaylistLink | null>({
    label: "Import from a link",
    align: "top",
    dismissed: null,
    render: (finish) => <LinkCard initial={initial} finish={finish} />,
  });
  if (link !== null) openImportCard(link);
};

function LinkCard({
  initial,
  finish,
}: {
  initial: string;
  finish: (link: PlaylistLink | null) => void;
}) {
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const [value, setValue] = useState(initial);
  const check = recognisePlaylistLink(value);

  const confirm = () => {
    if (check.ok) finish(check.link);
  };

  return (
    <>
      <CatalogLine>Import from a link</CatalogLine>
      <TextInput
        value={value}
        onChangeText={setValue}
        autoFocus
        selectTextOnFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={confirm}
        accessibilityLabel="Playlist link"
        placeholder="YouTube Music or Spotify playlist link"
        placeholderTextColor={secondary}
        selectionColor={accent}
        cursorColor={accent}
        numberOfLines={1}
        className="font-sans text-body text-foreground"
        style={{ height: grid.row, padding: 0 }}
      />
      <Hairline />
      {/* The line is reserved so the actions don't jump when a reason appears. */}
      <Text
        accessibilityLiveRegion="polite"
        className="font-sans text-footnote text-secondary"
        style={{ minHeight: CELL * 3, paddingTop: CELL / 2 }}
      >
        {check.ok || check.problem === "empty" ? "" : check.reason}
      </Text>
      <View className="flex-row justify-end" style={{ gap: CELL * 3 }}>
        <TextButton label="Cancel" onPress={() => finish(null)} />
        <TextButton label="Continue" onPress={confirm} disabled={!check.ok} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Import card: what the playlist is, Import or Cancel

const COVER = CELL * 9;

const READING: LinkRead = { status: "reading" };

const openImportCard = (link: PlaylistLink): void => {
  openOverlay({
    label: "Import playlist",
    render: (close) => <ImportCard link={link} close={close} />,
  });
};

/**
 * Reads [link] as it opens (again on Try Again) and shows Core's
 * `linkImportView` of it, a Spotify playlist's finding progress included.
 * Closing the card (Cancel) or Try Again stops the read: nothing more is
 * requested.
 */
function ImportCard({ link, close }: { link: PlaylistLink; close: () => void }) {
  const [attempt, setAttempt] = useState(0);
  // The answer to an earlier attempt isn't shown: Try Again reads as "reading" at once.
  const [answer, setAnswer] = useState<{ readonly attempt: number; readonly read: LinkRead }>();

  useEffect(() => {
    const controller = new AbortController();
    const show = (read: LinkRead) => {
      if (!controller.signal.aborted) setAnswer({ attempt, read });
    };
    void readLinkImport(link, show, controller.signal).then(show);
    return () => controller.abort();
  }, [link, attempt]);

  const read: LinkRead = answer?.attempt === attempt ? answer.read : READING;
  const view = linkImportView(read);
  const importIt = () => {
    if (read.status !== "read") return;
    close();
    void saveLinkImport(read.plan).catch((error: unknown) =>
      showError("Couldn't import the playlist", error),
    );
  };

  return (
    <>
      <View style={{ paddingTop: CELL, paddingBottom: CELL * 2, gap: CELL * 1.5 }}>
        <CatalogLine>
          {link.service === "ytMusic" ? "Import from YouTube Music" : "Import from Spotify"}
        </CatalogLine>
        <View className="flex-row items-center" style={{ gap: CELL * 1.5 }}>
          {view.name !== null && (
            <Artwork uri={view.artworkUrl ?? undefined} size={COVER} radius={CELL / 2} />
          )}
          <View className="flex-1" style={{ gap: CELL / 2 }}>
            {view.name !== null && (
              <Text numberOfLines={2} className="font-sans text-title3 font-normal text-foreground">
                {view.name}
              </Text>
            )}
            <Text
              accessibilityLiveRegion="polite"
              className="font-sans text-subheadline text-secondary"
            >
              {view.line}
            </Text>
          </View>
        </View>
        {view.note !== null && (
          <Text className="font-sans text-footnote text-secondary">{view.note}</Text>
        )}
      </View>
      <View className="flex-row items-center justify-end" style={{ gap: CELL * 3 }}>
        <TextButton label="Cancel" onPress={close} />
        {view.retry && <TextButton label="Try Again" onPress={() => setAttempt((n) => n + 1)} />}
        {view.canImport && <TextButton label="Import" onPress={importIt} />}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Summary: the songs left out

/** Shows Core's `linkImportSummary`: the songs not found, scrolling when they don't fit. */
const showSummary = (summary: ImportNotice): Promise<void> =>
  presentOverlay<void>({
    label: summary.title,
    dismissed: undefined,
    render: (finish) => <SummaryCard summary={summary} finish={() => finish(undefined)} />,
  });

function SummaryCard({ summary, finish }: { summary: ImportNotice; finish: () => void }) {
  return (
    <>
      <View style={{ gap: CELL, paddingTop: CELL, paddingBottom: CELL * 2, flexShrink: 1 }}>
        <Text className="font-sans text-title3 font-normal text-foreground">{summary.title}</Text>
        <ScrollView bounces={false} overScrollMode="never" style={{ flexGrow: 0 }}>
          <Text className="font-sans text-subheadline text-secondary">{summary.message}</Text>
        </ScrollView>
      </View>
      <View className="flex-row items-center justify-end">
        <TextButton label="OK" onPress={finish} />
      </View>
    </>
  );
}
