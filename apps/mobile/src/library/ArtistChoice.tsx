import { followUp as followMenuUp } from "@/overlay/overlay";
import { openFollowActions } from "./FollowButton";
import {
  activeTiming,
  continueTiming,
  noteTimingLinkFailure,
  timingSurfaceCommitted,
  timingLinkNavigated,
} from "@/lib/timing";
import { type ArtistLink, type StreamedArtistLink, type StreamedArtistTarget } from "@wave/core";
import * as Effect from "effect/Effect";
import { Fragment, useLayoutEffect } from "react";
import { View } from "react-native";

import type { ArtistImageSource } from "@/catalog/ArtistImage";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { NameRow } from "@/catalog/NameRow";
import { failNowPlayingLink, revealNowPlayingLink } from "@/nowPlaying/sheet";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { showError } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { followUp, openOverlay } from "@/overlay/overlay";
import { resolveStreamedArtistTap } from "@/ytmusic/streamedArtist";
import { followStreamedArtistTap } from "@/ytmusic/streamedArtistTap";
import { openYtArtistNamed } from "@/ytmusic/routes";

import { LibraryStore, type ArtistRow } from "./LibraryStore";
import { openArtist } from "./routes";
import { appRuntime } from "./runtime";

/** An artist the choice card lists: their row, and the page tapping it opens. */
interface ArtistChoice {
  readonly key: string;
  readonly name: string;
  /** The quiet second line: a Library artist's song count, or that they're YouTube Music's. */
  readonly detail: string;
  readonly image: ArtistImageSource;
  readonly open: () => void;
}

/**
 * Where Go to Artist and Now Playing's artist line lead (Core's `artistLink`):
 * one artist opens their page ([known] is their row, when read ahead), several
 * open a card to pick one from.
 */
export const followArtistLink = (link: ArtistLink, known?: ArtistRow | null): void => {
  continueTiming(
    link.kind === "open" ? "artistLink" : "choiceCard",
    link.kind === "open" ? "Artist" : "artist choice",
  );
  if (link.kind === "open") openArtist(link.artistId, known);
  else {
    const id = activeTiming()?.id;
    if (id !== undefined) noteTimingLinkFailure(id, "link not ready");
    openArtistChoice(link.artistIds, id);
  }
};

/** Opens [target]'s page integrated: the Library artist's, or the YouTube Music artist page. */
const openStreamedArtist = (target: StreamedArtistTarget<ArtistRow>): void => {
  if (target.kind === "library") openArtist(target.artist.id, target.artist, { integrated: true });
  else if (target.kind === "yt") openYtArtistNamed(target.name, target.offline);
};

/** A YouTube Music artist has no Library image: the row shows their initial. */
const noImage = (name: string): ArtistImageSource => ({ name, thumbPath: null, artworkPath: null });

const libraryChoice = (
  artist: ArtistRow,
  open = () => openArtist(artist.id, artist),
): ArtistChoice => ({
  key: `library-${artist.id}`,
  name: artist.name,
  detail: currentLocalisation().strings.library.songCount(artist.trackCount),
  image: artist,
  open,
});

const streamedChoice = (target: StreamedArtistTarget<ArtistRow>): ArtistChoice =>
  target.kind === "library"
    ? libraryChoice(target.artist, () => openStreamedArtist(target))
    : {
        key: `yt-${target.name}`,
        name: target.name,
        detail: "YouTube Music",
        image: noImage(target.name),
        open: () => openStreamedArtist(target),
      };

/**
 * Where a streamed song's Go to Artist and Now Playing's artist line lead
 * (Core's `streamedArtistLink`): one artist opens integrated, their Library
 * page or the YouTube Music artist page; several open the card to pick one.
 * The page you're on opens nothing: Now Playing closing reveals it. Every
 * outcome ends the tap's timing, so the screen settles again.
 */
export const followStreamedArtistLink = (link: StreamedArtistLink<ArtistRow>): void => {
  if (link.kind === "here") return;
  continueTiming("artistLink", "Artist");
  const timingId = activeTiming()?.id;
  if (timingId !== undefined) noteTimingLinkFailure(timingId, "link not ready");
  const deliver = (resolved: StreamedArtistLink<ArtistRow> | undefined) => {
    if (resolved === undefined) {
      failNowPlayingLink(timingId);
      const { library } = currentLocalisation().strings;
      showError(library.couldntOpenArtist, library.ytMusicTurnedOff);
      return;
    }
    if (resolved?.kind === "open") openStreamedArtist(resolved.target);
    else if (resolved?.kind === "choose") {
      continueTiming("choiceCard", "artist choice");
      openChoiceCard(resolved.targets.map(streamedChoice), timingId);
    } else if (resolved.kind === "here") revealNowPlayingLink(timingId);
    if (resolved !== undefined) timingLinkNavigated(timingId);
  };
  void followStreamedArtistTap(link, { resolve: resolveStreamedArtistTap, deliver }).catch(
    (error: unknown) => {
      failNowPlayingLink(timingId);
      showError(currentLocalisation().strings.library.couldntOpenArtist, error);
    },
  );
};

/** Each artist's row, in [ids]' order; one cheap read per artist, gone ones left out. */
const artistRows = (ids: readonly number[]): Promise<readonly ArtistRow[]> =>
  appRuntime.runPromise(
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    LibraryStore.use((store) =>
      Effect.forEach(ids, (artistId) => store.linkRows({ artistId })).pipe(
        Effect.map((rows) => rows.flatMap((row) => row.artist ?? [])),
      ),
    ),
  );

const openChoiceCard = (choices: readonly ArtistChoice[], timingId?: number): void => {
  openOverlay({
    label: currentLocalisation().strings.library.goToArtist,
    render: (close) => <ArtistChoiceCard choices={choices} close={close} />,
  });
  timingLinkNavigated(timingId);
};

/**
 * Opens the card that lists [artistIds] to pick one from, once their rows are
 * read (so it never grows once shown); what it was opened from stays
 * highlighted meanwhile.
 */
const openArtistChoice = (artistIds: readonly number[], timingId?: number): void => {
  void followUp(() =>
    artistRows(artistIds).then(
      (artists) => {
        if (artists.length === 0) {
          if (timingId !== undefined) noteTimingLinkFailure(timingId, "target gone");
          failNowPlayingLink(timingId);
          return;
        }
        openChoiceCard(
          artists.map((artist) => libraryChoice(artist)),
          timingId,
        );
      },
      (error: unknown) => {
        failNowPlayingLink(timingId);
        showError(currentLocalisation().strings.library.couldntReadArtists, error);
      },
    ),
  );
};

/**
 * The artist choice card: a "Go to Artist" catalog line, then each credited
 * artist as an artist row (their circle, name and song count, or "YouTube
 * Music" for an artist the Library doesn't have). Tapping one opens their page.
 */
function ArtistChoiceCard({
  choices,
  close,
}: {
  choices: readonly ArtistChoice[];
  close: () => void;
}) {
  useLayoutEffect(() => {
    const active = activeTiming();
    if (active?.kind === "choiceCard") timingSurfaceCommitted(active.id);
  }, []);
  const { strings } = useLocalisation();
  return (
    <>
      <View style={{ paddingBottom: CELL * 2 }}>
        <CatalogLine>{strings.library.goToArtist}</CatalogLine>
      </View>
      {/* Each artist follows a divider, so none trails the last. */}
      <CardEntries>
        {choices.map((choice) => (
          <Fragment key={choice.key}>
            <Hairline />
            <NameRow
              onLongPress={() => {
                close();
                void followMenuUp(async () => openFollowActions({ name: choice.name }));
              }}
              name={choice.name}
              detail={choice.detail}
              artist={choice.image}
              onPress={() => {
                close();
                continueTiming("artistLink", choice.name);
                choice.open();
              }}
            />
          </Fragment>
        ))}
      </CardEntries>
    </>
  );
}
