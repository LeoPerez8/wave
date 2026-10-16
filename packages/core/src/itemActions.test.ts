import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  actionBarLabel,
  artistLink,
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
  type YtSongActionOptions,
} from "./index.ts";

const names = (entries: readonly ItemActionEntry[]): string[] =>
  entries.map((entry) => entry.action);

const song = (fields: { albumId?: number; artistId?: number; favorite?: boolean } = {}) => ({
  albumId: fields.albumId ?? 1,
  artistIds: [fields.artistId ?? 10],
  favorite: fields.favorite ?? false,
});

const tracks = (
  items: ActionSubject["items"],
  rest: Partial<Omit<ActionSubject, "items" | "kind">> = {},
): ActionSubject => ({ kind: "track", items, surface: "menu", here: "/library/songs", ...rest });

/** Albums checked in the Albums grid, by their album artists. */
const albums = (artistIds: readonly number[]): ActionSubject => ({
  kind: "album",
  items: artistIds.map((artistId) => ({ artistIds: [artistId] })),
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
      ["delete", "removeFromLibrary"],
    );
    assert.ok(!names(itemActions({ kind: "album", items: [{}], here: "/" })).includes("delete"));
  });

  test("Delete and Remove from Library ask first, so the selection only ends once it's confirmed", () => {
    assert.deepEqual(
      Object.keys(ITEM_ACTION_LABELS).filter((action) => confirmsFirst(action as ItemAction)),
      ["deletePlaylist", "deletePlaylists", "delete", "removeFromLibrary"],
    );
  });

  test("a missing song's menu: Download first, no queueing, no file to delete or write to, Remove from Library last", () => {
    const missing = { ...song(), missing: true };
    assert.deepEqual(
      names(itemActions(tracks([missing], { selectable: true, onlineLookups: true }))),
      [
        "download",
        "addToPlaylist",
        "favorite",
        "goToAlbum",
        "goToArtist",
        "select",
        "removeFromLibrary",
      ],
    );
    assert.equal(ITEM_ACTION_LABELS.removeFromLibrary, "Remove from Library");
    // Like Delete, it keeps a button of its own on a crowded bar.
    const bar = itemActions(tracks([missing, missing], { surface: "selection" }));
    assert.ok(names(splitActionBar(bar, 2).bar).includes("removeFromLibrary"));
  });

  test("a missing song on its way offers Cancel Download; one that failed, Retry Download alone", () => {
    const menu = (download: NonNullable<ActionSubject["items"][number]["download"]>) =>
      names(itemActions(tracks([{ ...song(), missing: true, download }]))).slice(0, 2);
    assert.deepEqual(menu({ kind: "queued" }), ["cancelDownload", "addToPlaylist"]);
    assert.deepEqual(menu({ kind: "downloading", received: 1, total: 2 }), [
      "cancelDownload",
      "addToPlaylist",
    ]);
    assert.deepEqual(menu({ kind: "failed", reason: "notFound" }), [
      "retryDownload",
      "addToPlaylist",
    ]);
    // Too late to cancel while the file is saved.
    assert.deepEqual(menu({ kind: "saving" }), ["addToPlaylist", "favorite"]);
    assert.equal(ITEM_ACTION_LABELS.download, "Download");
    assert.equal(ITEM_ACTION_LABELS.cancelDownload, "Cancel Download");
    assert.equal(ITEM_ACTION_LABELS.retryDownload, "Retry Download");
  });

  test("missing songs checked together offer Download; a song with a file offers no download entries", () => {
    const missing = { ...song(), missing: true };
    const bar = names(itemActions(tracks([missing, missing], { surface: "selection" })));
    assert.deepEqual(bar.slice(0, 3), ["addToPlaylist", "favorite", "download"]);
    assert.ok(!names(itemActions(tracks([song()]))).includes("download"));
    assert.ok(
      !names(itemActions(tracks([song(), song()], { surface: "selection" }))).includes("download"),
    );
  });

  test("missing songs checked with songs that have a file queue those and download the rest; neither Delete nor Remove from Library shows", () => {
    const bar = names(
      itemActions(
        tracks([song(), { ...song(), missing: true }], {
          surface: "selection",
          onlineLookups: true,
        }),
      ),
    );
    assert.deepEqual(bar, [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "favorite",
      "download",
      "goToAlbum",
      "goToArtist",
    ]);
  });

  test("a song missing something offers Fix Song while online lookups are on, before Select and Delete", () => {
    const fixable = { ...song(), fixable: true };
    const menu = itemActions(tracks([fixable], { selectable: true, onlineLookups: true }));
    assert.deepEqual(names(menu).slice(-3), ["fixSong", "select", "delete"]);
    assert.equal(ITEM_ACTION_LABELS.fixSong, "Fix Song");
    assert.ok(!names(itemActions(tracks([fixable]))).includes("fixSong"));
    const album = itemActions({ kind: "album", items: [{}], here: "/", onlineLookups: true });
    assert.ok(!names(album).includes("fixSong"));
  });

  test("a song with lyrics, a track number, a year and a genre doesn't offer Fix Song", () => {
    const menu = itemActions(tracks([{ ...song(), fixable: false }], { onlineLookups: true }));
    assert.ok(!names(menu).includes("fixSong"));
  });

  test("selection offers Fix Songs when any checked song is missing something", () => {
    const bar = (fixable: readonly boolean[]) =>
      names(
        itemActions(
          tracks(
            fixable.map((each) => ({ ...song(), fixable: each })),
            { surface: "selection", onlineLookups: true },
          ),
        ),
      );
    assert.ok(bar([false, true, false]).includes("fixSongs"));
    assert.equal(ITEM_ACTION_LABELS.fixSongs, "Fix Songs");
    assert.ok(!bar([false, false]).some((action) => action.startsWith("fix")));
    // One checked song is Fix Song, as in its menu.
    assert.ok(bar([true]).includes("fixSong"));
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
        { action: "goToArtist", artists: { kind: "open", artistId: 9 } },
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
    for (const here of ["/library/album/4", "/albums/album/4"]) {
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
    assert.deepEqual(
      names(itemActions({ kind: "album", items: [{ artistIds: [3] }], here: "/" })),
      ["playNext", "addToQueue", "addToPlaylist", "goToArtist"],
    );
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
      names(
        itemActions({ kind: "album", items: [{ artistIds: [3] }], selectable: true, here: "/" }),
      ),
      ["playNext", "addToQueue", "addToPlaylist", "goToArtist", "select"],
    );
  });

  test("an album with missing songs offers Download Missing Songs after Add to Playlist", () => {
    const menu = itemActions({
      kind: "album",
      items: [{ artistIds: [3], missingSongs: [null, null] }],
      selectable: true,
      here: "/",
    });
    assert.deepEqual(names(menu), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "downloadMissingSongs",
      "goToArtist",
      "select",
    ]);
    assert.equal(ITEM_ACTION_LABELS.downloadMissingSongs, "Download Missing Songs");
  });

  test("an album's missing songs on their way offer Cancel Download, and Retry Failed once the rest has ended", () => {
    const album = (missingSongs: ActionSubject["items"][number]["missingSongs"]) =>
      names(itemActions({ kind: "album", items: [{ missingSongs }], here: "/" })).slice(3);
    const failed = { kind: "failed", reason: "notFound" } as const;
    // All of them asked for: nothing left to download.
    assert.deepEqual(album([{ kind: "queued" }, { kind: "downloading", received: 1, total: 2 }]), [
      "cancelDownload",
    ]);
    // One still to ask for, one failed while another downloads: no Retry Failed yet.
    assert.deepEqual(album([null, failed, { kind: "queued" }]), [
      "downloadMissingSongs",
      "cancelDownload",
    ]);
    assert.deepEqual(album([failed, { kind: "saving" }]), []);
    assert.deepEqual(album([failed, failed]), ["retryFailed"]);
    assert.deepEqual(album([null, failed]), ["downloadMissingSongs", "retryFailed"]);
    assert.equal(ITEM_ACTION_LABELS.retryFailed, "Retry Failed");
    assert.equal(ITEM_ACTION_LABELS.cancelDownload, "Cancel Download");
  });

  test("an album with no missing songs offers no download entries", () => {
    for (const missingSongs of [undefined, []]) {
      assert.deepEqual(
        names(itemActions({ kind: "album", items: [{ artistIds: [3], missingSongs }], here: "/" })),
        ["playNext", "addToQueue", "addToPlaylist", "goToArtist"],
      );
    }
  });

  test("selected albums holding missing songs offer Download on the bar, for all of theirs", () => {
    const bar = itemActions({
      kind: "album",
      items: [
        { missingSongs: [] },
        { missingSongs: [{ kind: "queued" }] },
        { missingSongs: [null] },
      ],
      surface: "selection",
      here: "/library/albums",
    });
    assert.deepEqual(names(bar), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "downloadMissingSongs",
      "cancelDownload",
    ]);
    assert.equal(actionBarLabel("downloadMissingSongs"), "Download");
    // On a crowded bar it keeps a button of its own.
    assert.ok(names(splitActionBar(bar, 4).bar).includes("downloadMissingSongs"));
    // Their songs all on their way: nothing to download.
    const asked = itemActions({
      kind: "album",
      items: [{ missingSongs: [{ kind: "queued" }] }, { missingSongs: [{ kind: "saving" }] }],
      surface: "selection",
      here: "/library/albums",
    });
    assert.ok(!names(asked).includes("downloadMissingSongs"));
  });

  test("selected artists or genres: the bar offers their menu's entries, but Select", () => {
    for (const kind of ["artist", "genre"] as const) {
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
    assert.ok(one.includes("renamePlaylist"));
    assert.equal(one.at(-1), "deletePlaylist");
    const two = names(
      itemActions({ kind: "playlist", items: [{}, {}], here: "/", surface: "selection" }),
    );
    assert.ok(!two.includes("renamePlaylist"));
  });

  test("a playlist's menu changes its image, and removes it once it has one", () => {
    const menu = (hasImage?: boolean) =>
      names(itemActions({ kind: "playlist", items: [{ hasImage }], here: "/" })).slice(-4);
    assert.deepEqual(menu(), ["addToPlaylist", "renamePlaylist", "changeImage", "deletePlaylist"]);
    assert.deepEqual(menu(true), [
      "renamePlaylist",
      "changeImage",
      "removeImage",
      "deletePlaylist",
    ]);
    assert.equal(ITEM_ACTION_LABELS.changeImage, "Change Image");
    assert.equal(ITEM_ACTION_LABELS.removeImage, "Remove Image");
    assert.ok(!isDestructiveAction("removeImage"));
    assert.ok(!confirmsFirst("removeImage"));
  });

  test("selecting a playlist doesn't offer its image entries: they're the menu's", () => {
    const bar = names(
      itemActions({
        kind: "playlist",
        items: [{ hasImage: true }],
        here: "/library/playlists",
        surface: "selection",
      }),
    );
    assert.ok(!bar.includes("changeImage"));
    assert.ok(!bar.includes("removeImage"));
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

  test("a genre, artist or Library entry: queue it and add it to a playlist", () => {
    for (const kind of ["genre", "artist", "section"] as const) {
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

describe("Go to Artist on a collaboration", () => {
  const goTo = (subject: ActionSubject) =>
    itemActions(subject).find((entry) => entry.action === "goToArtist");

  test("a song by Ariana Grande and Doja Cat offers both to pick from, in credit order", () => {
    assert.deepEqual(goTo(tracks([{ albumId: 1, artistIds: [7, 8] }])), {
      action: "goToArtist",
      artists: { kind: "choose", artistIds: [7, 8] },
    });
  });

  test("on one of their pages the other is left, so Go to Artist opens them straight away", () => {
    for (const here of ["/library/artist/7", "/artists/artist/7"]) {
      assert.deepEqual(goTo(tracks([{ albumId: 1, artistIds: [7, 8] }], { here })), {
        action: "goToArtist",
        artists: { kind: "open", artistId: 8 },
      });
    }
  });

  test("a choice leaves out the page you're on", () => {
    const entry = goTo(
      tracks([{ albumId: 1, artistIds: [7, 8, 9] }], { here: "/library/artist/8" }),
    );
    assert.deepEqual(entry, {
      action: "goToArtist",
      artists: { kind: "choose", artistIds: [7, 9] },
    });
  });

  test("an album with several album artists offers them the same way", () => {
    const album = (here: string): ActionSubject => ({
      kind: "album",
      items: [{ artistIds: [3, 4] }],
      here,
    });
    assert.deepEqual(goTo(album("/library/albums")), {
      action: "goToArtist",
      artists: { kind: "choose", artistIds: [3, 4] },
    });
    assert.deepEqual(goTo(album("/library/artist/3")), {
      action: "goToArtist",
      artists: { kind: "open", artistId: 4 },
    });
  });

  test("selected songs offer it only when they share the same artists, in any order", () => {
    const selection = (...artistIds: (readonly number[])[]) =>
      goTo(
        tracks(
          artistIds.map((ids) => ({ albumId: 1, artistIds: ids })),
          { surface: "selection" },
        ),
      );
    assert.deepEqual(selection([7, 8], [8, 7]), {
      action: "goToArtist",
      artists: { kind: "choose", artistIds: [7, 8] },
    });
    assert.equal(selection([7, 8], [7]), undefined);
    assert.equal(selection([7], [7, 8]), undefined);
    assert.equal(selection([7, 8], [7, 9]), undefined);
    assert.equal(selection([7, 8], []), undefined);
  });
});

describe("artistLink", () => {
  test("Now Playing's artist line: one artist opens straight away, several are a choice", () => {
    assert.deepEqual(artistLink([5], "/library/songs"), { kind: "open", artistId: 5 });
    assert.deepEqual(artistLink([5, 6], "/library/songs"), {
      kind: "choose",
      artistIds: [5, 6],
    });
  });

  test("leaves out the artist page you're on, and leads nowhere when that was the only one", () => {
    assert.deepEqual(artistLink([5, 6], "/library/artist/5"), { kind: "open", artistId: 6 });
    assert.equal(artistLink([5], "/artists/artist/5"), undefined);
    assert.equal(artistLink([], "/library/songs"), undefined);
  });
});

describe("itemActions on albums and songs checked together", () => {
  test("offers the entries an album's and a song's menus share, not Favorite or Delete", () => {
    const entries = itemActions(mixed([{ albumId: 2, artistIds: [10] }, song({ favorite: true })]));
    assert.deepEqual(names(entries), ["playNext", "addToQueue", "addToPlaylist"]);
  });

  test("Go to Artist when they share an artist, unless it's the page you're on", () => {
    const items = [{ albumId: 2, artistIds: [10] }, song({ albumId: 1, artistId: 10 })];
    assert.deepEqual(names(itemActions(mixed(items, "/library/albums"))), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "goToArtist",
    ]);
    assert.ok(!names(itemActions(mixed(items))).includes("goToArtist"));
  });

  test("Go to Album when the songs are from the album checked with them", () => {
    const entries = itemActions(mixed([{ albumId: 2, artistIds: [30] }, song({ albumId: 2 })]));
    assert.deepEqual(entries.at(-1), { action: "goToAlbum", albumId: 2 });
  });

  test("a YT Music song checked beside an album offers only their shared actions", () => {
    const entries = itemActions({
      ...mixed([
        { albumId: 2, artistIds: [10] },
        { streamed: true, artistNames: ["Justice"] },
      ]),
      surface: "selection",
    });
    assert.deepEqual(names(entries), ["playNext", "addToQueue", "addToPlaylist"]);
  });
});

/** A YT Music song, streamed, credited to [artistNames]. */
const streamed = (...artistNames: string[]) => ({ streamed: true, artistNames });

describe("itemActions on YT Music songs checked with the Library's", () => {
  test("they join the queue and playlists and download; Favorite, Fix Songs and Delete are the files'", () => {
    const bar = itemActions(
      tracks([{ ...song({ favorite: true }), fixable: true }, streamed("Justice")], {
        surface: "selection",
        onlineLookups: true,
      }),
    );
    assert.deepEqual(names(bar), ["playNext", "addToQueue", "addToPlaylist", "download"]);
  });

  test("a playlist's YT Music entries checked with its Library songs can be removed from it", () => {
    const bar = itemActions(
      tracks(
        [song({ favorite: true }), streamed("Justice")].map((item) => ({
          ...item,
          inPlaylist: true,
        })),
        {
          surface: "selection",
        },
      ),
    );
    assert.deepEqual(names(bar), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "removeFromPlaylist",
      "download",
    ]);
  });

  test("streamed songs alone offer what they offer beside the Library's", () => {
    const bar = itemActions(
      tracks([streamed("Justice"), streamed("Daft Punk")], { surface: "selection" }),
    );
    assert.deepEqual(names(bar), ["playNext", "addToQueue", "addToPlaylist", "download"]);
  });

  test("Download shows only while a checked song isn't downloaded", () => {
    const bar = (...items: ActionSubject["items"]) =>
      names(itemActions(tracks(items, { surface: "selection" })));
    // Downloaded since Search listed it: the Library has its file now.
    assert.ok(!bar(song(), { ...streamed("Justice"), downloaded: true }).includes("download"));
    assert.ok(bar({ ...song(), missing: true }, streamed("Justice")).includes("download"));
    // The long-press menu has its own download entries; Download is the bar's.
    assert.ok(!names(itemActions(tracks([streamed("Justice")]))).includes("download"));
  });
});

describe("Go to Artist on YT Music songs checked with the Library's", () => {
  const daftPunk = { id: 10, name: "Daft Punk" };
  /** The Library has Daft Punk (artist 10), not Justice. */
  const libraryArtist = (name: string) => (name === "Daft Punk" ? daftPunk : null);
  const goTo = (
    items: ActionSubject["items"],
    { enabled = true, here = "/search", ytArtistHere = null as string | null } = {},
  ) =>
    itemActions({
      kind: "track",
      items,
      surface: "selection",
      here,
      streamedArtists: { libraryArtist, enabled, ytArtistHere },
    }).find((entry) => entry.action === "goToArtist");

  test("a Library song and a streamed one by the same Library artist open their page, integrated", () => {
    assert.deepEqual(goTo([song({ artistId: 10 }), streamed("Daft Punk")]), {
      action: "goToArtist",
      streamedArtists: { kind: "open", target: { kind: "library", artist: daftPunk } },
    });
  });

  test("streamed songs by an artist the Library lacks open the YouTube Music artist page", () => {
    assert.deepEqual(goTo([streamed("Justice"), streamed("Justice")]), {
      action: "goToArtist",
      streamedArtists: { kind: "open", target: { kind: "yt", name: "Justice" } },
    });
  });

  test("a shared collaboration is a choice, in the first streamed song's credit order", () => {
    assert.equal(goTo([song({ artistId: 10 }), streamed("Justice", "Daft Punk")]), undefined);
    assert.deepEqual(goTo([streamed("Justice", "Daft Punk"), streamed("Daft Punk", "Justice")]), {
      action: "goToArtist",
      streamedArtists: {
        kind: "choose",
        targets: [
          { kind: "yt", name: "Justice" },
          { kind: "library", artist: daftPunk },
        ],
      },
    });
  });

  test("songs by different artists, YT Music off or the artist page you're on offer none", () => {
    assert.equal(goTo([song({ artistId: 10 }), streamed("Justice")]), undefined);
    assert.equal(goTo([song({ artistId: 11 }), streamed("Daft Punk")]), undefined);
    assert.equal(
      goTo([song({ artistId: 10 }), streamed("Daft Punk")], { enabled: false }),
      undefined,
    );
    assert.equal(
      goTo([streamed("Justice"), streamed("Justice")], { ytArtistHere: "Justice" }),
      undefined,
    );
    assert.equal(
      goTo([song({ artistId: 10 }), streamed("Daft Punk")], { here: "/library/artist/10" }),
      undefined,
    );
  });

  test("streamed songs whose artists can't be told offer none", () => {
    const bar = itemActions(
      tracks([streamed("Justice"), streamed("Justice")], { surface: "selection" }),
    );
    assert.ok(!names(bar).includes("goToArtist"));
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
  test("a YT Music song can join the queue and playlists, mixed with the Library's songs", () => {
    assert.deepEqual(
      ytSongActions().map((entry) => entry.action),
      ["playNext", "addToQueue", "addToPlaylist"],
    );
  });

  test("it offers Go to Artist, leading where the streamed song's artist link does", () => {
    const artists = { kind: "open", target: { kind: "yt", name: "Justice" } } as const;
    assert.deepEqual(ytSongActions(artists), [
      { action: "playNext" },
      { action: "addToQueue" },
      { action: "addToPlaylist" },
      { action: "goToArtist", artists },
    ]);
  });

  test("its only artist being the page you're on, there's no Go to Artist", () => {
    assert.deepEqual(
      ytSongActions({ kind: "here" }).map((entry) => entry.action),
      ["playNext", "addToQueue", "addToPlaylist"],
    );
  });

  test("shown in a playlist, it can be removed from it, as a Library song can", () => {
    const artists = { kind: "open", target: { kind: "yt", name: "Justice" } } as const;
    assert.deepEqual(
      ytSongActions(artists, { inPlaylist: true }).map((entry) => entry.action),
      ["playNext", "addToQueue", "addToPlaylist", "removeFromPlaylist", "goToArtist"],
    );
  });

  test("a song with a YT Music album offers Go to Album, before Go to Artist, leading to it", () => {
    const artists = { kind: "open", target: { kind: "yt", name: "Justice" } } as const;
    assert.deepEqual(ytSongActions(artists, { album: "MPREb_cross", ytMusic: true }), [
      { action: "playNext" },
      { action: "addToQueue" },
      { action: "addToPlaylist" },
      { action: "goToAlbum", album: "MPREb_cross" },
      { action: "goToArtist", artists },
    ]);
  });

  test("on its album's own page there's no Go to Album; another album's page offers it", () => {
    const actions = (ytAlbumHere: string) =>
      ytSongActions(undefined, { album: "MPREb_cross", ytAlbumHere, ytMusic: true }).map(
        (entry) => entry.action,
      );
    assert.deepEqual(actions("MPREb_cross"), ["playNext", "addToQueue", "addToPlaylist"]);
    assert.deepEqual(actions("MPREb_other"), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "goToAlbum",
    ]);
  });

  test("opened from a list that can select, it offers Select last, as a Library song's menu does", () => {
    const artists = { kind: "open", target: { kind: "yt", name: "Justice" } } as const;
    assert.deepEqual(
      ytSongActions(artists, { selectable: true }).map((entry) => entry.action),
      ["playNext", "addToQueue", "addToPlaylist", "goToArtist", "select"],
    );
    assert.ok(!ytSongActions(artists).some((entry) => entry.action === "select"));
  });

  test("a song without an album, or with YT Music off (a playlist's entry), has no Go to Album", () => {
    const actions = (options: YtSongActionOptions) =>
      ytSongActions(undefined, options).map((entry) => entry.action);
    const queue = ["playNext", "addToQueue", "addToPlaylist"];
    assert.deepEqual(actions({ album: null, ytMusic: true }), queue);
    assert.deepEqual(actions({ album: "", ytMusic: true }), queue);
    assert.deepEqual(actions({ ytMusic: true }), queue);
    assert.deepEqual(actions({ album: "MPREb_cross", ytMusic: false }), queue);
    assert.deepEqual(actions({ album: "MPREb_cross", inPlaylist: true }), [
      ...queue,
      "removeFromPlaylist",
    ]);
  });
});
