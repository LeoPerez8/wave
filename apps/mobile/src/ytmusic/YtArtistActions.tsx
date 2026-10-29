import { useFollow } from "@/library/follows";
import { followMenuPress } from "@/library/FollowButton";
import { PLAY_ACTION_LABELS, menuLayout, type DiscoverSong } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { Text, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { CELL } from "@/catalog/grid";
import type { SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { pressedMenuAllowed, pressedRect } from "@/motion/pressedRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { CardHeading } from "@/overlay/CardHeading";
import { MenuChoices, type MenuChoice } from "@/overlay/MenuChoices";
import { followUp, openOverlay } from "@/overlay/overlay";
import { useLocalisation } from "@/localisation/localisation";
import { playPage, queueDiscoverSongs } from "@/playback/actions";

import { ytArtistPageSongs } from "./artistPage";
import { currentLibraryFinder } from "./libraryFinder";

/** A YouTube Music artist as their row knows them (a Search result). */
export interface YtArtistTarget {
  /** Their artist page (`UC…`). */
  readonly browseId: string;
  readonly name: string;
  readonly artworkUrl?: string | null | undefined;
}

type Song = DiscoverSong<NativeYtSong, SongRow>;

/**
 * Opens a YouTube Music artist's long-press menu next to their row: Play,
 * Play Next and Add to Queue cards, then Shuffle, for the songs their page
 * plays (`ytArtistPageSongs`: what was saved for it, else read now). The
 * songs are read first, so the card opens ready. Follow remains available
 * offline or when the artist has no playable songs.
 */
export const openYtArtistActions = (artist: YtArtistTarget): void => {
  const anchor = pressedRect();
  const allowed = pressedMenuAllowed();
  void followUp(async () => {
    const find = await currentLibraryFinder();
    const result = await appRuntime.runPromise(
      Effect.result(ytArtistPageSongs(artist.browseId, find)),
    );
    if (!allowed()) return;
    const songs = Result.isSuccess(result) ? result.success : [];
    openOverlay({
      label: artist.name,
      anchor,
      render: (close) => <YtArtistActionsMenu artist={artist} songs={songs} close={close} />,
    });
  });
};

/** The menu card: the artist (unless their row is highlighted), then the cards and Shuffle. */
function YtArtistActionsMenu({
  artist,
  songs,
  close,
}: {
  artist: YtArtistTarget;
  songs: readonly Song[];
  close: () => void;
}) {
  const { strings } = useLocalisation();
  const follow = useFollow(artist.name);
  // As their page plays them: the Library's files for the songs it has, the rest streamed.
  const context = { kind: "ytArtist", id: artist.browseId };
  const closing = (action: () => void) => () => {
    close();
    action();
  };
  const play = (shuffle: boolean) =>
    closing(() => void playPage(songs, undefined, context, { shuffle }));
  const layout = menuLayout("ytArtist", [], { empty: songs.length === 0 });
  const cards = layout.cards.map((action) => ({
    action,
    onPress:
      action === "play" ? play(false) : closing(() => void queueDiscoverSongs(songs, action)),
  }));
  const entries = layout.list.map(({ action }): MenuChoice => ({
    action,
    label: PLAY_ACTION_LABELS[action],
    onPress: play(true),
  }));

  entries.push({
    action: "follow",
    label: follow === null ? strings.library.follow : strings.library.following,
    onPress: () => followMenuPress({ name: artist.name, ytBrowseId: artist.browseId }, close),
  });
  return (
    <>
      <CardHeading>
        <ArtistImage
          artist={{
            name: artist.name,
            thumbPath: null,
            artworkPath: null,
            imageUrl: artist.artworkUrl,
          }}
          size={CELL * 5}
        />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {artist.name}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            YouTube Music
          </Text>
        </View>
      </CardHeading>
      <MenuChoices cards={cards} entries={entries} />
    </>
  );
}
