/** Extra artist-page cases: an appearance, saved Popular order and remote-only additions. */
import * as Effect from "effect/Effect";
import { sql } from "drizzle-orm";
import type { FastAgainFixture } from "../../src/library/db/fastAgainFixture.ts";
import type { loadArtistOpening } from "./artistOpeningReplay.ts";

export const seedArtistOpening = (
  fixture: FastAgainFixture,
  opening: Awaited<ReturnType<typeof loadArtistOpening>>,
) => {
  const appearances = [fixture.targets.small.albumIds[1]!, fixture.targets.large.albumIds[1]!];
  const original = fixture.db.all<{ id: number; artist: number; credit: string }>(sql`
    SELECT id, album_artist_id AS artist, album_artist_credit AS credit FROM albums
    WHERE id IN (${sql.join(
      appearances.map((id) => sql`${id}`),
      sql`, `,
    )})`);
  const other = fixture.db.get<{ id: number; name: string }>(sql`SELECT id, name FROM artists
    WHERE id NOT IN (${fixture.targets.small.artistId}, ${fixture.targets.large.artistId}) ORDER BY id LIMIT 1`);
  for (const albumId of appearances) {
    fixture.db.run(
      sql`UPDATE albums SET album_artist_id = ${other.id}, album_artist_credit = ${other.name} WHERE id = ${albumId}`,
    );
    fixture.db.run(
      sql`UPDATE album_artists SET artist_id = ${other.id} WHERE album_id = ${albumId}`,
    );
  }
  const keys: string[] = [];
  for (const target of [fixture.targets.small, fixture.targets.large]) {
    const detail = Effect.runSync(opening.store.getArtist(target.artistId))!;
    const songs = detail.songs.toReversed().map((song, i) => ({
      videoId: `saved-${i}`,
      title: song.title,
      artists: [song.artist],
      album: song.album,
      durationMs: song.durationMs,
      artworkUrl: null,
      albumId: null,
      explicit: false,
    }));
    const foreign = Effect.runSync(opening.store.songsByIds([fixture.songIds.at(-2)!]))[0]!;
    const allSongs = [
      ...songs,
      {
        videoId: "foreign",
        title: foreign.title,
        artists: [foreign.artist],
        album: foreign.album,
        durationMs: foreign.durationMs,
        artworkUrl: null,
        albumId: null,
        explicit: false,
      },
      {
        videoId: "remote-only",
        title: "Only online",
        artists: [detail.artist.name],
        album: "New release",
        durationMs: 180000,
        artworkUrl: null,
        albumId: null,
        explicit: false,
      },
    ];
    const albums = [...detail.albums, ...detail.appearsOn].map((album) => ({
      kind: "album" as const,
      browseId: `release-${album.id}`,
      title: album.title,
      artists: [detail.artist.name],
      year: album.year,
      artworkUrl: null,
    }));
    const key = opening.core.identityKey(detail.artist.name);
    keys.push(key);
    Effect.runSync(
      opening.store.saveYtArtist(key, {
        outcome: "found",
        checkedAt: fixture.now,
        browseId: `artist-${target.artistId}`,
        page: {
          name: detail.artist.name,
          songs: allSongs.slice(0, 3),
          allSongs,
          albums,
          singles: [
            {
              kind: "album",
              browseId: "new-single",
              title: "New single",
              artists: [detail.artist.name],
              year: 2026,
              artworkUrl: null,
            },
          ],
        },
      }),
    );
  }
  return () => {
    for (const row of original) {
      fixture.db.run(
        sql`UPDATE albums SET album_artist_id = ${row.artist}, album_artist_credit = ${row.credit} WHERE id = ${row.id}`,
      );
      fixture.db.run(
        sql`UPDATE album_artists SET artist_id = ${row.artist} WHERE album_id = ${row.id}`,
      );
    }
    for (const key of keys) fixture.db.run(sql`DELETE FROM yt_artists WHERE artist_key = ${key}`);
  };
};
