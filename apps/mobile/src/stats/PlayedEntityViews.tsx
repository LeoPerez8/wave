import { useScreenSettled } from "@/lib/screenTiming";
import { useScreenSight } from "@/lib/screenSight";
import { isScreenSettled } from "@/lib/timing";
import { online } from "@/native/waveNative";
import { loadPlayedArtistImage, openPlayedRelease } from "./playedEntityOpening";
import { artistPhotoName } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";

import { AlbumCard } from "@/catalog/cards/AlbumCard";
import { ArtistCard } from "@/catalog/cards/ArtistCard";
import { NameRow } from "@/catalog/NameRow";
import type { PlayedAlbum, PlayedArtist, OnlineAlbum } from "@/library/db/playedEntities";
import { openAlbum, openArtist } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { showMessage } from "@/overlay/alert";
import { openAlbumActions, openArtistActions } from "@/playback/ActionsMenu";
import { ArtworkRow } from "@/search/ArtworkRow";
import { useYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";
import { openYtAlbum, openYtArtistNamed } from "@/ytmusic/routes";
import { YtMusic } from "@/ytmusic/YtMusic";

const openOnlineAlbum = async (album: OnlineAlbum): Promise<void> => {
  if (!ytMusicEnabled()) return;
  try {
    const result = await openPlayedRelease(
      album,
      ytMusicEnabled,
      (query) => appRuntime.runPromise(Effect.flatMap(YtMusic, (yt) => yt.searchAlbums(query))),
      (id) =>
        openYtAlbum(id, {
          title: album.title,
          line: album.albumArtist,
          artworkUrl: album.artworkUrl,
        }),
    );
    if (result === "missing")
      await showMessage("Album not found", "This album couldn't be found online.");
  } catch {
    if (ytMusicEnabled()) await showMessage("Couldn't open album", "Try again when you're online.");
  }
};

const artistImages = new Map<string, Promise<string | null>>();

/** Artist photos are requested only while online entries are visible and YT Music is enabled. */
const usePlayedArtist = (artist: PlayedArtist) => {
  const enabled = useYtMusicEnabled();
  const isOnlineArtist = "online" in artist;
  const settled = useScreenSettled();
  const sight = useScreenSight();
  const visible = useSyncExternalStore(sight.subscribe, sight.visible);
  const [photo, setPhoto] = useState<{ name: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!isOnlineArtist || !enabled || !settled || !visible || !online()) return;
    let current = true;
    const key = artistPhotoName(artist.name);
    let pending = artistImages.get(key);
    if (pending === undefined) {
      pending = loadPlayedArtistImage(
        artist.name,
        { enabled: ytMusicEnabled, settled: isScreenSettled, visible: sight.visible, online },
        (name) => appRuntime.runPromise(Effect.flatMap(YtMusic, (yt) => yt.searchArtists(name))),
      );
      artistImages.set(key, pending);
      void pending.catch(() => artistImages.delete(key));
    }
    void pending
      .then((url) => {
        if (current) setPhoto({ name: artist.name, url });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [artist.name, enabled, isOnlineArtist, settled, sight, visible]);
  return {
    unavailable: isOnlineArtist && !enabled,
    image: isOnlineArtist
      ? {
          ...artist,
          placeholder: !enabled,
          imageUrl: enabled && photo?.name === artist.name ? photo.url : null,
        }
      : artist,
    open: () => {
      if ("online" in artist) {
        if (ytMusicEnabled()) openYtArtistNamed(artist.name);
      } else openArtist(artist.id, artist);
    },
    menu: isOnlineArtist ? undefined : () => openArtistActions(artist),
  };
};

const usePlayedAlbum = (album: PlayedAlbum) => {
  const enabled = useYtMusicEnabled();
  const isOnlineAlbum = "online" in album;
  return {
    unavailable: isOnlineAlbum && !enabled,
    artworkUri: isOnlineAlbum
      ? enabled
        ? (album.artworkUrl ?? undefined)
        : undefined
      : album.thumbPath === null
        ? undefined
        : `file://${album.thumbPath}`,
    open: () => {
      if ("online" in album) void openOnlineAlbum(album);
      else openAlbum(album.id, album);
    },
    menu: isOnlineAlbum ? undefined : () => openAlbumActions(album),
  };
};

export function PlayedAlbumRow({
  album,
  detail,
  index,
}: {
  album: PlayedAlbum;
  detail: string;
  index: number;
}) {
  const row = usePlayedAlbum(album);
  return (
    <ArtworkRow
      title={album.title}
      detail={`${album.albumArtist} · ${detail}`}
      artworkUri={row.artworkUri}
      rank={{ number: index + 1, top: index === 0 }}
      unavailable={row.unavailable}
      onPress={row.open}
      onLongPress={row.menu}
    />
  );
}

export function PlayedArtistRow({
  artist,
  detail,
  index,
}: {
  artist: PlayedArtist;
  detail: string;
  index: number;
}) {
  const row = usePlayedArtist(artist);
  return (
    <NameRow
      name={artist.name}
      artist={row.image}
      detail={detail}
      rank={{ number: index + 1, top: index === 0 }}
      unavailable={row.unavailable}
      onPress={row.open}
      onLongPress={row.menu}
    />
  );
}

export function PlayedAlbumCard({
  album,
  detail,
  size,
}: {
  album: PlayedAlbum;
  detail?: string | undefined;
  size: number;
}) {
  const row = usePlayedAlbum(album);
  return (
    <View
      style={{ opacity: row.unavailable ? 0.4 : 1 }}
      pointerEvents={row.unavailable ? "none" : "auto"}
      accessibilityState={{ disabled: row.unavailable }}
    >
      <AlbumCard
        title={album.title}
        artist={[album.albumArtist, detail].filter(Boolean).join(" · ")}
        artworkUri={row.artworkUri}
        size={size}
        onPress={row.open}
        onLongPress={row.menu}
      />
    </View>
  );
}

export function PlayedArtistCard({ artist, size }: { artist: PlayedArtist; size: number }) {
  const row = usePlayedArtist(artist);
  return (
    <View
      style={{ opacity: row.unavailable ? 0.4 : 1 }}
      pointerEvents={row.unavailable ? "none" : "auto"}
      accessibilityState={{ disabled: row.unavailable }}
    >
      <ArtistCard
        name={artist.name}
        artist={row.image}
        size={size}
        onPress={row.open}
        onLongPress={row.menu}
      />
    </View>
  );
}
