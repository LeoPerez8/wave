import { openAlbumActions } from "@/playback/ActionsMenu";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  followArtistKey,
  matchFollowRelease,
  releaseDateLine,
  type FollowRelease,
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
import { hideRelease, useFollowReleases } from "./followReleases";
import { HomeSectionSkeleton } from "./HomeSectionSkeleton";

const resolve = async (release: FollowRelease, artist: string): Promise<string | null> => {
  if (!followedArtistsEnabled() || !ytMusicEnabled()) return null;
  if (release.browseId) return release.browseId;
  const result = await askYtMusic((yt) =>
    withSearchTurn("search", release.title, yt.searchAlbums(`${artist} ${release.title}`)),
  );
  if (Result.isFailure(result) || !followedArtistsEnabled() || !ytMusicEnabled()) return null;
  const match = matchFollowRelease(
    release,
    result.success.filter((a) =>
      a.artists.some((name) => followArtistKey(name) === release.artistKey),
    ),
  );
  if (!match) return null;
  const album = await askYtMusic((yt) =>
    withSearchTurn("search", release.title, yt.album(match.browseId)),
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
                    browseId: match.browseId,
                    videoIds: album.success.tracks.map((t) => t.videoId),
                  }
                : r,
            ),
            artistCache.checkedAt,
          );
      }),
    );
  return match.browseId;
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
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void action()
      .catch(() => showMessage(release.title, "No answer online. Try again in a moment."))
      .finally(() => setBusy(false));
  };
  const head = { title: release.title, line: follow.name, artworkUrl: release.artworkUrl };
  const hide = () => {
    void hideRelease(release.key)
      .then(refresh)
      .catch(() => showMessage(release.title, "Couldn't hide this release. Try again."));
  };
  const entries: MenuChoice[] = [
    { action: "goToArtist", label: "Go to Artist", onPress: () => openYtArtistNamed(follow.name) },
    { action: "removeFromLibrary", label: "Hide", onPress: hide },
  ];
  const open = () =>
    run(async () => {
      if (release.libraryAlbumId) {
        openAlbum(release.libraryAlbumId);
        return;
      }
      const id = await resolve(release, follow.name);
      if (id) openYtAlbum(id, head);
      else await showMessage(release.title, "Not on YouTube Music yet");
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
      const id = await resolve(release, follow.name);
      if (id) openYtAlbumActions({ ...head, browseId: id }, { releaseEntries: entries });
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
  const tag = release.type === "ep" ? "EP" : release.type === "single" ? "Single" : "Album";
  const [now] = useState(() => Date.now());
  const date = releaseDateLine(release.releaseDate, now);
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
  const { cards, follows, refresh } = useFollowReleases();
  if (cards === undefined) return <HomeSectionSkeleton id="new-releases" />;
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
