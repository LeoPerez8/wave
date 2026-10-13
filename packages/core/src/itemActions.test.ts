import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  actionBarLabel,
  confirmsFirst,
  isDestructiveAction,
  ITEM_ACTION_LABELS,
  commonKind,
  itemActions,
  splitActionBar,
  ytSongActions,
  type ActionSubject,
  type ItemAction,
  type ItemActionEntry,
} from "./index.ts";

const names = (entries: readonly ItemActionEntry[]): string[] =>
  entries.map((entry) => entry.action);

const song = (fields: { albumId?: number; artistId?: number; favorite?: boolean } = {}) => ({
  albumId: fields.albumId ?? 1,
  artistId: fields.artistId ?? 10,
  favorite: fields.favorite ?? false,
});

const tracks = (
  items: ActionSubject["items"],
  rest: Partial<Omit<ActionSubject, "items" | "kind">> = {},
): ActionSubject => ({ kind: "track", items, surface: "menu", here: "/library/songs", ...rest });

/** Albums checked in the Albums grid, by their album artists. */
const albums = (artistIds: readonly number[]): ActionSubject => ({
  kind: "album",
  items: artistIds.map((artistId) => ({ artistId })),
  surface: "selection",
  here: "/library/albums",
});

describe("itemActions", () => {
  test("a song's menu: queue it, add it to a playlist, star it, go to its album and artist, delete it", () => {
    assert.deepEqual(names(itemActions(tracks([song()]))), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "favorite",
      "goToAlbum",
      "goToArtist",
      "delete",
    ]);
  });

  test("Delete comes last for songs, after Select, and is the destructive one", () => {
    const menu = itemActions(tracks([song()], { selectable: true }));
    assert.deepEqual(names(menu).slice(-2), ["select", "delete"]);
    assert.deepEqual(
      Object.keys(ITEM_ACTION_LABELS).filter((action) => isDestructiveAction(action as ItemAction)),
      ["delete"],
    );
    assert.ok(!names(itemActions({ kind: "album", items: [{}], here: "/" })).includes("delete"));
  });

  test("Delete asks first, so the selection only ends once it's confirmed", () => {
    assert.deepEqual(
      Object.keys(ITEM_ACTION_LABELS).filter((action) => confirmsFirst(action as ItemAction)),
      ["deletePlaylist", "deletePlaylists", "delete"],
    );
  });

  test("songs offer Find Lyrics and Genre while online lookups are on, before Select and Delete", () => {
    const menu = itemActions(tracks([song()], { selectable: true, onlineLookups: true }));
    assert.deepEqual(names(menu).slice(-3), ["findLyricsAndGenre", "select", "delete"]);
    assert.equal(ITEM_ACTION_LABELS.findLyricsAndGenre, "Find Lyrics and Genre");
    const bar = itemActions(
      tracks([song(), song()], { surface: "selection", onlineLookups: true }),
    );
    assert.ok(names(bar).includes("findLyricsAndGenre"));
    assert.ok(!names(itemActions(tracks([song()]))).includes("findLyricsAndGenre"));
    const album = itemActions({ kind: "album", items: [{}], here: "/", onlineLookups: true });
    assert.ok(!names(album).includes("findLyricsAndGenre"));
  });

  test("a starred song offers Remove from Favorites instead", () => {
    assert.deepEqual(
      names(itemActions(tracks([song({ favorite: true })]))).filter((name) => name.includes("av")),
      ["unfavorite"],
    );
  });

  test("Select shows in the menu of a list that can select, never in the selection bar", () => {
    assert.ok(names(itemActions(tracks([song()], { selectable: true }))).includes("select"));
    assert.ok(!names(itemActions(tracks([song()]))).includes("select"));
    assert.ok(
      !names(itemActions(tracks([song()], { selectable: true, surface: "selection" }))).includes(
        "select",
      ),
    );
  });

  test("for one song the selection bar offers exactly the menu's entries, Select aside", () => {
    const subject = tracks([song({ favorite: true })], { selectable: true });
    assert.deepEqual(
      itemActions({ ...subject, surface: "selection" }),
      itemActions(subject).filter((entry) => entry.action !== "select"),
    );
  });

  test("Go to Album and Go to Artist lead where the songs all are", () => {
    const entries = itemActions(tracks([song({ albumId: 4, artistId: 9 })]));
    assert.deepEqual(
      entries.filter((entry) => entry.action === "goToAlbum" || entry.action === "goToArtist"),
      [
        { action: "goToAlbum", albumId: 4 },
        { action: "goToArtist", artistId: 9 },
      ],
    );
  });

  test("songs from different albums of one artist offer Go to Artist only", () => {
    const entries = names(
      itemActions(
        tracks([song({ albumId: 1, artistId: 5 }), song({ albumId: 2, artistId: 5 })], {
          surface: "selection",
        }),
      ),
    );
    assert.ok(!entries.includes("goToAlbum"));
    assert.ok(entries.includes("goToArtist"));
  });

  test("songs by different artists on one album offer Go to Album only", () => {
    const entries = names(
      itemActions(
        tracks([song({ albumId: 3, artistId: 5 }), song({ albumId: 3, artistId: 6 })], {
          surface: "selection",
        }),
      ),
    );
    assert.ok(entries.includes("goToAlbum"));
    assert.ok(!entries.includes("goToArtist"));
  });

  test("no Go to entry for the page you're already on", () => {
    const entries = names(
      itemActions(tracks([song({ albumId: 4, artistId: 9 })], { here: "/library/album/4" })),
    );
    assert.ok(!entries.includes("goToAlbum"));
    assert.ok(entries.includes("goToArtist"));
  });

  test("an album page's selection bar: Go to Artist when the songs share one, never Go to Album", () => {
    for (const here of ["/library/album/4", "/shortcut/album/4"]) {
      const shared = names(
        itemActions(
          tracks([song({ albumId: 4, artistId: 9 }), song({ albumId: 4, artistId: 9 })], {
            surface: "selection",
            here,
          }),
        ),
      );
      assert.deepEqual(shared, [
        "playNext",
        "addToQueue",
        "addToPlaylist",
        "favorite",
        "goToArtist",
        "delete",
      ]);
      const mixed = names(
        itemActions(
          tracks([song({ albumId: 4, artistId: 9 }), song({ albumId: 4, artistId: 2 })], {
            surface: "selection",
            here,
          }),
        ),
      );
      assert.ok(!mixed.includes("goToAlbum"));
      assert.ok(!mixed.includes("goToArtist"));
    }
  });

  test("Favorite stars the selection unless every song in it is starred already", () => {
    const mixed = tracks([song({ favorite: true }), song()], { surface: "selection" });
    const starred = tracks([song({ favorite: true }), song({ favorite: true })], {
      surface: "selection",
    });
    assert.ok(names(itemActions(mixed)).includes("favorite"));
    assert.ok(names(itemActions(starred)).includes("unfavorite"));
    assert.ok(!names(itemActions(starred)).includes("favorite"));
  });

  test("songs opened from a playlist offer Remove from Playlist", () => {
    const inPlaylist = { ...song(), inPlaylist: true };
    assert.ok(names(itemActions(tracks([inPlaylist]))).includes("removeFromPlaylist"));
    assert.ok(!names(itemActions(tracks([song()]))).includes("removeFromPlaylist"));
  });

  test("an album: queue it, add it to a playlist, go to its artist", () => {
    assert.deepEqual(names(itemActions({ kind: "album", items: [{ artistId: 3 }], here: "/" })), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "goToArtist",
    ]);
  });

  test("selected albums: the menu's entries, Go to Artist only when they share an album artist, no Favorite", () => {
    assert.deepEqual(names(itemActions(albums([3, 3]))), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "goToArtist",
    ]);
    assert.deepEqual(names(itemActions(albums([3, 4]))), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
    ]);
    assert.deepEqual(
      names(itemActions({ kind: "album", items: [{ artistId: 3 }], selectable: true, here: "/" })),
      ["playNext", "addToQueue", "addToPlaylist", "goToArtist", "select"],
    );
  });

  test("selected artists, genres or folders: the bar offers their menu's entries, but Select", () => {
    for (const kind of ["artist", "genre", "folder"] as const) {
      const menu = names(itemActions({ kind, items: [{}], selectable: true, here: "/library" }));
      const bar = names(
        itemActions({ kind, items: [{}, {}, {}], surface: "selection", here: "/library" }),
      );
      assert.deepEqual(menu, ["playNext", "addToQueue", "addToPlaylist", "select"]);
      assert.deepEqual(bar, ["playNext", "addToQueue", "addToPlaylist"]);
    }
  });

  test("a playlist can be renamed and deleted, one at a time", () => {
    const one = names(itemActions({ kind: "playlist", items: [{}], here: "/" }));
    assert.deepEqual(one.slice(-2), ["renamePlaylist", "deletePlaylist"]);
    const two = names(
      itemActions({ kind: "playlist", items: [{}, {}], here: "/", surface: "selection" }),
    );
    assert.ok(!two.includes("renamePlaylist"));
  });

  test("selected playlists: queue them, add them to a playlist, Rename and Delete Playlist only for one", () => {
    const selected = (count: number) =>
      names(
        itemActions({
          kind: "playlist",
          items: Array.from({ length: count }, () => ({})),
          here: "/library/playlists",
          surface: "selection",
        }),
      );
    assert.deepEqual(selected(1), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "renamePlaylist",
      "deletePlaylist",
    ]);
    assert.deepEqual(selected(3), ["playNext", "addToQueue", "addToPlaylist", "deletePlaylists"]);
    assert.equal(ITEM_ACTION_LABELS.deletePlaylists, "Delete Playlists");
  });

  test("a genre, folder, artist or Library entry: queue it and add it to a playlist", () => {
    for (const kind of ["genre", "folder", "artist", "section"] as const) {
      assert.deepEqual(names(itemActions({ kind, items: [{}], here: "/" })), [
        "playNext",
        "addToQueue",
        "addToPlaylist",
      ]);
    }
  });

  test("an empty selection offers nothing", () => {
    assert.deepEqual(itemActions(tracks([], { surface: "selection" })), []);
  });
});

/** Albums and songs checked together on an artist's page. */
const mixed = (items: ActionSubject["items"], here = "/library/artist/10"): ActionSubject => ({
  kind: "mixed",
  items,
  surface: "selection",
  here,
});

describe("itemActions on albums and songs checked together", () => {
  test("offers the entries an album's and a song's menus share, not Favorite or Delete", () => {
    const entries = itemActions(mixed([{ albumId: 2, artistId: 10 }, song({ favorite: true })]));
    assert.deepEqual(names(entries), ["playNext", "addToQueue", "addToPlaylist"]);
  });

  test("Go to Artist when they share an artist, unless it's the page you're on", () => {
    const items = [{ albumId: 2, artistId: 10 }, song({ albumId: 1, artistId: 10 })];
    assert.deepEqual(names(itemActions(mixed(items, "/library/albums"))), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "goToArtist",
    ]);
    assert.ok(!names(itemActions(mixed(items))).includes("goToArtist"));
  });

  test("Go to Album when the songs are from the album checked with them", () => {
    const entries = itemActions(mixed([{ albumId: 2, artistId: 30 }, song({ albumId: 2 })]));
    assert.deepEqual(entries.at(-1), { action: "goToAlbum", albumId: 2 });
  });
});

describe("commonKind", () => {
  test("items of one kind keep it", () => {
    assert.equal(commonKind(["track", "track"]), "track");
    assert.equal(commonKind(["album"]), "album");
  });

  test("albums and songs together are mixed", () => {
    assert.equal(commonKind(["album", "track", "album"]), "mixed");
  });
});

describe("splitActionBar", () => {
  const bar = (actions: readonly ItemAction[], slots = 5) => {
    const split = splitActionBar(
      actions.map((action) => ({ action })),
      slots,
    );
    return { bar: split.bar.map((e) => e.action), more: split.more.map((e) => e.action) };
  };

  test("every entry gets a button when they fit", () => {
    assert.deepEqual(bar(["playNext", "addToQueue", "addToPlaylist", "goToArtist"]), {
      bar: ["playNext", "addToQueue", "addToPlaylist", "goToArtist"],
      more: [],
    });
  });

  test("past the slots, the rest goes behind More, in order; a song selection keeps Delete on the bar", () => {
    assert.deepEqual(
      bar([
        "playNext",
        "addToQueue",
        "addToPlaylist",
        "favorite",
        "goToAlbum",
        "goToArtist",
        "delete",
      ]),
      {
        bar: ["playNext", "addToQueue", "addToPlaylist", "favorite", "delete"],
        more: ["goToAlbum", "goToArtist"],
      },
    );
  });

  test("a playlist's tracks keep every primary action and Delete on the bar, More taking a seventh slot", () => {
    assert.deepEqual(
      bar([
        "playNext",
        "addToQueue",
        "addToPlaylist",
        "unfavorite",
        "removeFromPlaylist",
        "goToAlbum",
        "goToArtist",
        "delete",
      ]),
      {
        bar: [
          "playNext",
          "addToQueue",
          "addToPlaylist",
          "unfavorite",
          "removeFromPlaylist",
          "delete",
        ],
        more: ["goToAlbum", "goToArtist"],
      },
    );
    assert.deepEqual(
      bar(["playNext", "addToQueue", "addToPlaylist", "favorite", "removeFromPlaylist", "delete"]),
      {
        bar: [
          "playNext",
          "addToQueue",
          "addToPlaylist",
          "favorite",
          "removeFromPlaylist",
          "delete",
        ],
        more: [],
      },
    );
  });

  test("secondary entries fill spare slots before More", () => {
    assert.deepEqual(
      bar(["playNext", "addToQueue", "goToAlbum", "goToArtist", "renamePlaylist", "delete"]),
      {
        bar: ["playNext", "addToQueue", "goToAlbum", "delete"],
        more: ["goToArtist", "renamePlaylist"],
      },
    );
  });
});

describe("actionBarLabel", () => {
  test("long labels get a short caption for a bar button; the rest keep their label", () => {
    assert.equal(actionBarLabel("removeFromPlaylist"), "Remove");
    // A soft hyphen: on a crowded bar it breaks as "Un-" / "favorite" rather than shrinking.
    assert.equal(actionBarLabel("unfavorite"), "Un\u00ADfavorite");
    assert.equal(actionBarLabel("playNext"), "Play Next");
    assert.equal(actionBarLabel("addToPlaylist"), "Add to Playlist");
  });
});

describe("ytSongActions", () => {
  test("a YT Music song can join the queue, mixed with the Library's songs", () => {
    assert.deepEqual(names(ytSongActions()), ["playNext", "addToQueue"]);
  });
});
