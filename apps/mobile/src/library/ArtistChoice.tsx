import { counted, type ArtistLink } from "@wave/core";
import * as Effect from "effect/Effect";
import { Fragment } from "react";
import { View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { NameRow } from "@/catalog/NameRow";
import { showError } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { followUp, openOverlay } from "@/overlay/overlay";

import { LibraryStore, type ArtistRow } from "./LibraryStore";
import { openArtist } from "./routes";
import { appRuntime } from "./runtime";

/**
 * Where Go to Artist and Now Playing's artist line lead (Core's `artistLink`):
 * one artist opens their page ([known] is their row, when read ahead), several
 * open a card to pick one from.
 */
export const followArtistLink = (link: ArtistLink, known?: ArtistRow | null): void => {
  if (link.kind === "open") openArtist(link.artistId, known);
  else openArtistChoice(link.artistIds);
};

/** Each artist's row, in [ids]' order; one cheap read per artist, gone ones left out. */
const artistRows = (ids: readonly number[]): Promise<readonly ArtistRow[]> =>
  appRuntime.runPromise(
    LibraryStore.use((store) =>
      Effect.forEach(ids, (artistId) => store.linkRows({ artistId })).pipe(
        Effect.map((rows) => rows.flatMap((row) => row.artist ?? [])),
      ),
    ),
  );

/**
 * Opens the card that lists [artistIds] to pick one from, once their rows are
 * read (so it never grows once shown); what it was opened from stays
 * highlighted meanwhile.
 */
const openArtistChoice = (artistIds: readonly number[]): void => {
  void followUp(() =>
    artistRows(artistIds).then(
      (artists) => {
        openOverlay({
          label: "Go to Artist",
          render: (close) => <ArtistChoiceCard artists={artists} close={close} />,
        });
      },
      (error: unknown) => showError("Couldn't read the artists", error),
    ),
  );
};

/**
 * The artist choice card: a "Go to Artist" catalog line, then each credited
 * artist as an artist row (their circle, name and song count). Tapping one
 * opens their page.
 */
function ArtistChoiceCard({
  artists,
  close,
}: {
  artists: readonly ArtistRow[];
  close: () => void;
}) {
  return (
    <>
      <View style={{ paddingBottom: CELL * 2 }}>
        <CatalogLine>Go to Artist</CatalogLine>
      </View>
      {/* Each artist follows a divider, so none trails the last. */}
      <CardEntries>
        {artists.map((artist) => (
          <Fragment key={artist.id}>
            <Hairline />
            <NameRow
              name={artist.name}
              detail={counted(artist.trackCount, "song")}
              artist={artist}
              onPress={() => {
                close();
                openArtist(artist.id, artist);
              }}
            />
          </Fragment>
        ))}
      </CardEntries>
    </>
  );
}
