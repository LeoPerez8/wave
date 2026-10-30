import { YtMusicError } from "@/ytmusic/YtMusic";
import { useLocalisation } from "@/localisation/localisation";
import { openAlbumActions } from "@/playback/ActionsMenu";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  followReleaseOpening,
  releaseDateLine,
  type FollowRelease,
  type FollowReleaseOpening,
  type FollowedArtist,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { Artwork } from "@/catalog/Artwork";
import { CoverRow, COVER_ROW_TILE } from "@/catalog/CoverRow";
import { CardTile, CardTitle, CardDetail } from "@/catalog/cards/CardParts";
import { CELL } from "@/catalog/grid";
import { TitledSection } from "@/catalog/TitledSection";
import { openAlbum } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { LibraryStore } from "@/library/LibraryStore";
import { openYtAlbum, openYtArtistNamed } from "@/ytmusic/routes";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { followedArtistsEnabled } from "@/settings/followedArtists";
import { showMessage } from "@/overlay/alert";
import { openOverlay } from "@/overlay/overlay";
import { MenuChoices, type MenuChoice } from "@/overlay/MenuChoices";
import { openYtAlbumActions } from "@/ytmusic/YtAlbumActions";
import { hideRelease } from "./followReleases";
import { useHomeFollow } from "./useHomeFollow";

const guardedRequest = <A,>(read: Effect.Effect<A, YtMusicError>) =>
  Effect.gen(function* () {
    if (!followedArtistsEnabled() || !ytMusicEnabled())
      return yield* Effect.fail(new YtMusicError({ reason: "disabled" }));
    return yield* read;
  });
/** Where a release the Library lacks opens (Core's `followReleaseOpening`), after an Albums search when unmatched. */
const resolve = async (release: FollowRelease, artist: string): Promise<FollowReleaseOpening> => {
  const ytMusic = () => followedArtistsEnabled() && ytMusicEnabled();
  const opening = followReleaseOpening(release, { ytMusic: ytMusic() });
  if (opening.kind !== "search") return opening;
  const result = await askYtMusic((yt) =>
    withSearchTurn(
      "search",
      release.title,
      guardedRequest(yt.searchAlbums(`${artist} ${release.title}`)),
    ),
  );
  const found = followReleaseOpening(release, {
    ytMusic: ytMusic(),
    found: Result.isSuccess(result) ? result.success : null,
  });
  if (found.kind !== "open") return found;
  const album = await askYtMusic((yt) =>
    withSearchTurn("search", release.title, guardedRequest(yt.album(found.browseId))),
  );
  if (Result.isSuccess(album) && followedArtistsEnabled())
    await appRuntime.runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        const cache = yield* store.followReleaseCache;
        const artistCache = cache.artists.find((a) => a.key === release.artistKey);
        if (artistCache)
          yield* store.saveFollowReleases(
            release.artistKey,
            artistCache.releases.map((r) =>
              r.key === release.key
                ? {
                    ...r,
                    browseId: found.browseId,
                    videoIds: album.success.tracks.map((t) => t.videoId),
                  }
                : r,
            ),
            artistCache.checkedAt,
          );
      }),
    );
  return found;
};

function ReleaseTile({
  release,
  follow,
  refresh,
}: {
  release: FollowRelease;
  follow: FollowedArtist;
  refresh: () => void;
}) {
  const { strings } = useLocalisation();
  const copy = strings.newReleases;
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void action()
      .catch(() => showMessage(release.title, copy.noAnswer))
      .finally(() => setBusy(false));
  };
  const head = { title: release.title, line: follow.name, artworkUrl: release.artworkUrl };
  const hide = () => {
    void hideRelease(release.key)
      .then(refresh)
      .catch(() => showMessage(release.title, copy.hideFailed));
  };
  const entries: MenuChoice[] = [
    { action: "goToArtist", label: copy.goToArtist, onPress: () => openYtArtistNamed(follow.name) },
    { action: "removeFromLibrary", label: copy.hide, onPress: hide },
  ];
  const open = () =>
    run(async () => {
      if (release.libraryAlbumId) {
        openAlbum(release.libraryAlbumId);
        return;
      }
      const opening = await resolve(release, follow.name);
      if (opening.kind === "open") openYtAlbum(opening.browseId, head);
      else if (opening.kind === "ytMusicOff") await showMessage(release.title, copy.ytMusicOff);
      else if (opening.kind === "noAnswer") await showMessage(release.title, copy.noAnswer);
      else await showMessage(release.title, copy.unavailable);
    });
  const menu = () =>
    run(async () => {
      if (release.libraryAlbumId) {
        const owned = await appRuntime.runPromise(
          Effect.flatMap(LibraryStore, (s) => s.getAlbum(release.libraryAlbumId!)),
        );
        if (owned) {
          openAlbumActions(owned.album, { extraEntries: entries });
          return;
        }
      }
      const opening = await resolve(release, follow.name);
      if (opening.kind === "open")
        openYtAlbumActions({ ...head, browseId: opening.browseId }, { releaseEntries: entries });
      else
        openOverlay({
          label: release.title,
          render: (close) => (
            <MenuChoices
              cards={[]}
              entries={entries.map((e) => ({
                ...e,
                onPress: () => {
                  close();
                  e.onPress();
                },
              }))}
            />
          ),
        });
    });
  const tag =
    release.type === "ep" ? copy.ep : release.type === "single" ? copy.single : copy.album;
  const [now] = useState(() => Date.now());
  const date = releaseDateLine(release.releaseDate, now, strings);
  return (
    <CardTile
      width={COVER_ROW_TILE}
      label={`${release.title}, ${tag}, ${follow.name}, ${date}`}
      onPress={open}
      onLongPress={menu}
    >
      <View>
        <Artwork uri={release.artworkUrl ?? undefined} size={COVER_ROW_TILE} radius={CELL * 0.75} />
        <View className="absolute bottom-2 left-2 rounded bg-background px-2 py-1">
          <Text className="font-sans text-caption text-foreground">{tag}</Text>
        </View>
      </View>
      <View style={{ paddingTop: CELL }}>
        <CardTitle>{release.title}</CardTitle>
        <CardDetail size="footnote">{follow.name}</CardDetail>
        <CardDetail size="footnote">{date}</CardDetail>
      </View>
    </CardTile>
  );
}
export function NewReleases({ title }: { title: string }) {
  const { releaseCards: cards, follows, refresh } = useHomeFollow();
  if (cards.length === 0) return null;
  return (
    <TitledSection title={title}>
      <CoverRow>
        {cards.map((r) => (
          <ReleaseTile
            key={r.key}
            release={r}
            follow={follows.find((f) => f.key === r.artistKey)!}
            refresh={refresh}
          />
        ))}
      </CoverRow>
    </TitledSection>
  );
}
