/** Exact active-artist counts for #586, separate from the shared song/history sizes. */
import { sql } from "drizzle-orm";
import {
  addLibrary,
  closeTestDatabase,
  openTestDatabase,
} from "../../src/library/db/testDatabase.ts";

export const createArtistLinkFixture = async (artists: number, songs = artists) => {
  const db = await openTestDatabase();
  try {
    addLibrary(db, { tracks: songs, artists, albums: artists });
    db.run(sql`DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks)`);
    db.run(sql`DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM tracks)`);
    db.run(
      sql`UPDATE artists SET name = printf('Artist %05d', id - 2), sort = printf('artist %05d', id - 2), key = printf('artist %05d', id - 2)`,
    );
    db.run(
      sql`UPDATE tracks SET artist_credit = (SELECT name FROM artists WHERE artists.id = tracks.artist_id)`,
    );
    db.run(
      sql`UPDATE albums SET album_artist_credit = (SELECT name FROM artists WHERE artists.id = albums.album_artist_id)`,
    );
    db.run(
      sql`INSERT INTO album_artists (album_id, artist_id, position) SELECT id, album_artist_id, 0 FROM albums`,
    );
    const rows = db.all<{ id: number; name: string }>(
      sql`SELECT id, name FROM artists ORDER BY sort, id`,
    );
    if (rows.length !== artists) throw new Error(`expected ${artists} artists, got ${rows.length}`);
    return {
      db,
      artists,
      songs,
      first: rows[0]!,
      middle: rows[Math.floor(artists / 2)]!,
      last: rows.at(-1)!,
      close: () => closeTestDatabase(db),
    };
  } catch (error) {
    closeTestDatabase(db);
    throw error;
  }
};
