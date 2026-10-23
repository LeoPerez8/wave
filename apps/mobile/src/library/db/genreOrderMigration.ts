/** #601: persisted genre sort keys, maintained by SQLite for every writer. */
export const genreOrderMigration = `
CREATE TABLE genre_order (
  id integer PRIMARY KEY NOT NULL,
  genre_id integer NOT NULL,
  title_sort text NOT NULL,
  artist_sort text NOT NULL,
  album_sort text NOT NULL,
  album_id integer NOT NULL,
  disc_number integer NOT NULL,
  track_number integer NOT NULL,
  added_at integer NOT NULL,
  path text NOT NULL
);
--> statement-breakpoint
CREATE TABLE genre_order_state (id integer PRIMARY KEY CHECK (id = 1), revision integer NOT NULL);
--> statement-breakpoint
INSERT INTO genre_order_state VALUES (1, 0);
--> statement-breakpoint
CREATE INDEX genre_order_title_asc ON genre_order (genre_id, title_sort ASC, artist_sort, path, id);
--> statement-breakpoint
CREATE INDEX genre_order_title_desc ON genre_order (genre_id, title_sort DESC, artist_sort, path, id);
--> statement-breakpoint
CREATE INDEX genre_order_artist_asc ON genre_order (genre_id, artist_sort ASC, album_sort, album_id, disc_number, track_number, title_sort, path, id);
--> statement-breakpoint
CREATE INDEX genre_order_artist_desc ON genre_order (genre_id, artist_sort DESC, album_sort, album_id, disc_number, track_number, title_sort, path, id);
--> statement-breakpoint
CREATE INDEX genre_order_album_asc ON genre_order (genre_id, album_sort ASC, album_id, disc_number, track_number, title_sort, path, id);
--> statement-breakpoint
CREATE INDEX genre_order_album_desc ON genre_order (genre_id, album_sort DESC, album_id, disc_number, track_number, title_sort, path, id);
--> statement-breakpoint
CREATE INDEX genre_order_added_asc ON genre_order (genre_id, added_at ASC, title_sort, artist_sort, path, id);
--> statement-breakpoint
CREATE INDEX genre_order_added_desc ON genre_order (genre_id, added_at DESC, title_sort, artist_sort, path, id);
--> statement-breakpoint
INSERT INTO genre_order SELECT t.id, t.genre_id, t.title_sort, a.sort, b.title_sort, t.album_id,
    coalesce(t.disc_number, 1), coalesce(t.track_number, 9007199254740991),
    t.added_at, coalesce(t.path, '') FROM tracks t
    JOIN artists a ON a.id = t.artist_id JOIN albums b ON b.id = t.album_id WHERE t.genre_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER genre_order_track_insert AFTER INSERT ON tracks BEGIN
  INSERT INTO genre_order SELECT t.id, t.genre_id, t.title_sort, a.sort, b.title_sort, t.album_id,
    coalesce(t.disc_number, 1), coalesce(t.track_number, 9007199254740991),
    t.added_at, coalesce(t.path, '') FROM tracks t
    JOIN artists a ON a.id = t.artist_id JOIN albums b ON b.id = t.album_id WHERE t.id = NEW.id AND t.genre_id IS NOT NULL;
  UPDATE genre_order_state SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER genre_order_track_update AFTER UPDATE ON tracks BEGIN
  DELETE FROM genre_order WHERE id = OLD.id;
  INSERT INTO genre_order SELECT t.id, t.genre_id, t.title_sort, a.sort, b.title_sort, t.album_id,
    coalesce(t.disc_number, 1), coalesce(t.track_number, 9007199254740991),
    t.added_at, coalesce(t.path, '') FROM tracks t
    JOIN artists a ON a.id = t.artist_id JOIN albums b ON b.id = t.album_id WHERE t.id = NEW.id AND t.genre_id IS NOT NULL;
  UPDATE genre_order_state SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER genre_order_track_delete AFTER DELETE ON tracks BEGIN
  DELETE FROM genre_order WHERE id = OLD.id;
  UPDATE genre_order_state SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER genre_order_artists AFTER UPDATE OF sort ON artists BEGIN
  UPDATE genre_order SET artist_sort = NEW.sort WHERE id IN (SELECT id FROM tracks WHERE artist_id = NEW.id);
  UPDATE genre_order_state SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER genre_order_albums AFTER UPDATE OF title_sort ON albums BEGIN
  UPDATE genre_order SET album_sort = NEW.title_sort WHERE id IN (SELECT id FROM tracks WHERE album_id = NEW.id);
  UPDATE genre_order_state SET revision = revision + 1;
END;
`;
