import { YtMusicError } from "@/ytmusic/YtMusic";
import { useLocalisation } from "@/localisation/localisation";
import { openAlbumActions } from "@/playback/ActionsMenu";
import { IconPlayerPlay } from "@tabler/icons-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  releaseDateLine,
  type FollowAlbumRead,
  type FollowRelease,
  type FollowReleaseOpening,
  type FollowedArtist,
} from "@wave/core";
import { openFollowRelease } from "@wave/client/follows/followReleaseOpen";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { Artwork } from "@/catalog/Artwork";
import { CoverRow, COVER_ROW_TILE } from "@/catalog/CoverRow";
import { CardTile, CardTitle, CardDetail } from "@/catalog/cards/CardParts";
import { CELL } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
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
import { playNewReleases } from "./playNewReleases";
import { useHomeFollow } from "./useHomeFollow";
import { followReleaseItem } from "@/playback/mixedItems";
import type { HomeSelection } from "@/selection/useHomeSelection";
import { TileCheck } from "@/catalog/CheckCell";

const guardedRequest = <A,>(read: Effect.Effect<A, YtMusicError>) =>
  Effect.gen(function* () {
    if (!followedArtistsEnabled() || !ytMusicEnabled())
      return yield* Effect.fail(new YtMusicError({ reason: "disabled" }));
    return yield* read;
  });
/**
 * Where a release the Library lacks opens (`openFollowRelease`): a matched one on its album, also
 * with no answer; one whose album reads with no songs loses its match and comes back as not found.
 */
const resolve = (release: FollowRelease, artist: string): Promise<FollowReleaseOpening> => {
  const read = async <A,>(ask: Parameters<typeof askYtMusic<A, YtMusicError>>[0]) => {
    const result = await askYtMusic(ask);
    return Result.isSuccess(result) ? result.success : null;
  };
  return appRuntime.runPromise(
    Effect.flatMap(LibraryStore, (store) =>
      openFollowRelease(store, release, artist, {
        ytMusic: () => followedArtistsEnabled() && ytMusicEnabled(),
        keep: followedArtistsEnabled,
        searchAlbums: (query) =>
          read((yt) =>
            withSearchTurn("search", release.title, guardedRequest(yt.searchAlbums(query))),
          ),
        album: async (browseId): Promise<FollowAlbumRead> => {
          const result = await askYtMusic((yt) =>
            withSearchTurn("search", release.title, guardedRequest(yt.album(browseId))),
          );
          // Any failure is no answer: the page opens and says why, and the match stays. An album
          // that reads with no songs is gone. The album screen shares this read (`readYtAlbum`).
          return Result.isSuccess(result)
            ? { videoIds: result.success.tracks.map((t) => t.videoId) }
            : "noAnswer";
        },
      }),
    ),
  );
};

function ReleaseTile({
  release,
  follow,
  refresh,
  selection,
}: {
  release: FollowRelease;
  follow: FollowedArtist;
  refresh: () => void;
  selection: HomeSelection;
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
  const item = selection.remember(followReleaseItem(release, follow.name));
  const select = () => selection.start(item);
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
      else {
        // Not on YT Music (any more): the card hides until a check finds it again.
        refresh();
        await showMessage(release.title, copy.unavailable);
      }
    });
  const menu = () =>
    run(async () => {
      if (release.libraryAlbumId) {
        const owned = await appRuntime.runPromise(
          Effect.flatMap(LibraryStore, (s) => s.getAlbum(release.libraryAlbumId!)),
        );
        if (owned) {
          openAlbumActions(owned.album, {
            extraEntries: entries,
            onSelect: selection.enabled ? select : undefined,
          });
          return;
        }
      }
      if (release.browseId !== null && followedArtistsEnabled() && ytMusicEnabled())
        openYtAlbumActions(
          { ...head, browseId: release.browseId },
          { releaseEntries: entries, onSelect: selection.enabled ? select : undefined },
        );
      else
        openOverlay({
          label: release.title,
          render: (close) => (
            <MenuChoices
              cards={[]}
              entries={[
                ...entries,
                ...(selection.enabled
                  ? [
                      {
                        action: "select" as const,
                        label: strings.itemActions.labels.select,
                        onPress: select,
                      },
                    ]
                  : []),
              ].map((e) => ({
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
      checked={selection.selecting ? selection.isChecked(item) : undefined}
      onPress={() => (selection.selecting ? selection.toggle(item) : open())}
      onLongPress={selection.selecting ? undefined : menu}
    >
      <View>
        <Artwork uri={release.artworkUrl ?? undefined} size={COVER_ROW_TILE} radius={CELL * 0.75} />
        {selection.selecting && <TileCheck checked={selection.isChecked(item)} />}
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
/**
 * The header's Play: every release shown, newest first, replacing the queue (`playNewReleases`);
 * busy until the first one plays.
 */
function PlayReleases({ title, cards }: { title: string; cards: readonly FollowRelease[] }) {
  const { strings } = useLocalisation();
  const [busy, setBusy] = useState(false);
  const play = () => {
    if (busy) return;
    setBusy(true);
    let shown = false;
    const done = () => {
      if (shown) return;
      shown = true;
      setBusy(false);
    };
    // The button frees once this play's first release plays; the rest keep joining the queue.
    void playNewReleases(cards, done)
      .then((played) => {
        if (!played) void showMessage(title, strings.newReleases.noAnswer);
      })
      .catch(() => showMessage(title, strings.newReleases.noAnswer))
      .finally(done);
  };
  return (
    <IconButton
      icon={IconPlayerPlay}
      label={strings.newReleases.playSection(title)}
      busy={busy}
      onPress={play}
    />
  );
}

export function NewReleases({ title, selection }: { title: string; selection: HomeSelection }) {
  const { releaseCards: cards, follows, refresh } = useHomeFollow();
  if (cards.length === 0) return null;
  return (
    <TitledSection
      title={title}
      control={<PlayReleases title={title} cards={cards} />}
      selecting={selection.selecting}
    >
      <CoverRow>
        {cards.map((r) => (
          <ReleaseTile
            key={r.key}
            release={r}
            follow={follows.find((f) => f.key === r.artistKey)!}
            refresh={refresh}
            selection={selection}
          />
        ))}
      </CoverRow>
    </TitledSection>
  );
}
