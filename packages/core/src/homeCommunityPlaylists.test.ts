import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HOME_COMMUNITY_PLAYLISTS,
  HOME_COMMUNITY_PLAYLISTS_RETRY_MS,
  communityPlaylistsAccount,
  homeCommunityPlaylists,
  homeCommunityPlaylistsDue,
  homeCommunityPlaylistsShown,
  keptCommunityPlaylists,
  newCommunityPlaylistsSalt,
  parseKeptCommunityPlaylists,
  storedKeptCommunityPlaylists,
  type YtAccount,
  type YtCommunityPlaylist,
  type YtPlaylistShelf,
} from "./index.ts";

const playlist = (playlistId: string, title = `Playlist ${playlistId}`): YtCommunityPlaylist => ({
  playlistId,
  title,
  author: "Someone",
  artworkUrl: `https://covers.example/${playlistId}`,
});

const shelf = (title: string, ...ids: string[]): YtPlaylistShelf => ({
  title,
  playlists: ids.map((id) => playlist(id)),
});

const ids = (playlists: readonly YtCommunityPlaylist[]) => playlists.map((p) => p.playlistId);

describe("the playlists Home takes from YouTube Music's home", () => {
  test("the shelves are flattened in their order, each shelf's playlists in its order", () => {
    const shelves = [
      shelf("From the community", "a", "b"),
      shelf("Calm tunes", "c"),
      shelf("Throwbacks", "d", "e"),
    ];
    assert.deepEqual(ids(homeCommunityPlaylists(shelves)), ["a", "b", "c", "d", "e"]);
    assert.deepEqual(homeCommunityPlaylists(shelves)[0], playlist("a"));
  });

  test("a playlist on two shelves, or twice on one, shows once, where it first was", () => {
    const shelves = [
      shelf("From the community", "a", "b", "a"),
      shelf("Calm tunes", "b", "c", "a"),
    ];
    assert.deepEqual(ids(homeCommunityPlaylists(shelves)), ["a", "b", "c"]);
  });

  test("the list stops at 20 playlists, duplicates not counting towards them", () => {
    assert.equal(HOME_COMMUNITY_PLAYLISTS, 20);
    const many = Array.from({ length: 30 }, (_, index) => `p${index}`);
    const shelves = [
      shelf("First", ...many.slice(0, 12), "p0", "p1"),
      shelf("Second", ...many.slice(12)),
    ];
    assert.deepEqual(ids(homeCommunityPlaylists(shelves)), many.slice(0, 20));
  });

  test("no shelves, or only empty ones, give no playlists", () => {
    assert.deepEqual(homeCommunityPlaylists([]), []);
    assert.deepEqual(homeCommunityPlaylists([shelf("Empty")]), []);
  });
});

/** A moment on the phone's clock (local time, so the calendar day is the phone's). */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).getTime();

/** This phone's salt, as `newCommunityPlaylistsSalt` makes one. */
const SALT = "5f1c9a07d3e2b864";

const account = (email: string | null, name = "Leo"): YtAccount => ({
  name,
  email,
  photoUrl: null,
});

const LEO = communityPlaylistsAccount(account("leo@gmail.com"), SALT);
const ANA = communityPlaylistsAccount(account("ana@gmail.com", "Ana"), SALT);

describe("whose list it is", () => {
  test("an account is known by its email, whatever its case or spaces", () => {
    assert.equal(communityPlaylistsAccount(account(" Leo@Gmail.com"), SALT), LEO);
    assert.notEqual(LEO, ANA);
  });

  test("an account without an email is known by its name", () => {
    const named = (name: string) => communityPlaylistsAccount(account(null, name), SALT);
    assert.equal(named("Leo"), named("Leo"));
    assert.notEqual(named("Leo"), named("Ana"));
    assert.notEqual(named("Leo"), LEO);
  });

  test("the key is salted with the phone's own salt: a guessed email alone doesn't give it", () => {
    const elsewhere = communityPlaylistsAccount(account("leo@gmail.com"), "0123456789abcdef");
    assert.notEqual(elsewhere, LEO);
    assert.equal(LEO.includes("leo"), false);
  });

  test("each phone makes its own salt", () => {
    let seed = 0;
    const random = () => ((seed = (seed * 7 + 3) % 11) + 0.5) / 11;
    const first = newCommunityPlaylistsSalt(random);
    const second = newCommunityPlaylistsSalt(random);
    assert.match(first, /^[0-9a-f]{16}$/);
    assert.notEqual(first, second);
    assert.match(newCommunityPlaylistsSalt(), /^[0-9a-f]{16}$/);
  });
});

/** What the phone keeps after reading [shelves] at [now] as [account]. */
const readAs = (account: string, now: number, ...shelves: YtPlaylistShelf[]) =>
  keptCommunityPlaylists(null, shelves, { now, account });

describe("when YouTube Music's home is read", () => {
  const idle = { account: LEO, reading: false, retryAt: null };

  test("never read, it is read with a connected account and not without one", () => {
    assert.equal(homeCommunityPlaylistsDue(null, { ...idle, now: at(20, 9) }), true);
    assert.equal(
      homeCommunityPlaylistsDue(null, { ...idle, account: null, now: at(20, 9) }),
      false,
    );
  });

  test("it is read at most once a day, and again from the next calendar day", () => {
    const kept = readAs(LEO, at(20, 9), shelf("One", "a"));
    assert.equal(homeCommunityPlaylistsDue(kept, { ...idle, now: at(20, 9, 1) }), false);
    assert.equal(homeCommunityPlaylistsDue(kept, { ...idle, now: at(20, 23, 59) }), false);
    assert.equal(homeCommunityPlaylistsDue(kept, { ...idle, now: at(21, 0, 1) }), true);
    assert.equal(
      homeCommunityPlaylistsDue(kept, { ...idle, account: null, now: at(21, 0, 1) }),
      false,
    );
  });

  test("a list read as another account doesn't count: the new account's home is read at once", () => {
    const kept = readAs(LEO, at(20, 9), shelf("One", "a"));
    assert.equal(
      homeCommunityPlaylistsDue(kept, { ...idle, account: ANA, now: at(20, 9, 1) }),
      true,
    );
    assert.equal(
      homeCommunityPlaylistsDue(kept, {
        ...idle,
        account: communityPlaylistsAccount(account(" Leo@Gmail.com"), SALT),
        now: at(20, 9, 1),
      }),
      false,
    );
  });

  test("a read dated after now means the clock went back: it is read again", () => {
    const kept = readAs(LEO, at(20, 9));
    assert.equal(homeCommunityPlaylistsDue(kept, { ...idle, now: at(20, 8) }), true);
  });

  test("no second read starts while one is going", () => {
    assert.equal(
      homeCommunityPlaylistsDue(null, { ...idle, reading: true, now: at(20, 9) }),
      false,
    );
  });

  test("after a failed read, the next waits ten minutes", () => {
    assert.equal(HOME_COMMUNITY_PLAYLISTS_RETRY_MS, 10 * 60 * 1000);
    const retryAt = at(20, 9) + HOME_COMMUNITY_PLAYLISTS_RETRY_MS;
    assert.equal(homeCommunityPlaylistsDue(null, { ...idle, retryAt, now: at(20, 9, 9) }), false);
    assert.equal(homeCommunityPlaylistsDue(null, { ...idle, retryAt, now: at(20, 9, 10) }), true);
  });
});

describe("the list the phone keeps", () => {
  test("a read keeps the flattened playlists and when it was read", () => {
    const kept = readAs(LEO, 1234, shelf("One", "a", "b"), shelf("Two", "b", "c"));
    assert.equal(kept.readAt, 1234);
    assert.deepEqual(ids(kept.playlists), ["a", "b", "c"]);
  });

  test("it doesn't hold the account's email", () => {
    const stored = storedKeptCommunityPlaylists(readAs(LEO, 1234, shelf("One", "a")));
    assert.equal(stored?.includes("leo"), false);
    assert.equal(stored?.includes("gmail"), false);
  });

  test("a read replaces the list kept before", () => {
    const before = readAs(LEO, 1000, shelf("One", "a", "b"));
    const kept = keptCommunityPlaylists(before, [shelf("One", "c")], { now: 2000, account: LEO });
    assert.deepEqual([kept.readAt, ids(kept.playlists)], [2000, ["c"]]);
  });

  test("a home without playlist shelves keeps the last playlists and counts as the day's read", () => {
    const before = readAs(LEO, at(20, 9), shelf("One", "a", "b"));
    const kept = keptCommunityPlaylists(before, [], { now: at(21, 9), account: LEO });
    assert.deepEqual([kept.readAt, ids(kept.playlists)], [at(21, 9), ["a", "b"]]);
    assert.equal(
      homeCommunityPlaylistsDue(kept, {
        account: LEO,
        reading: false,
        retryAt: null,
        now: at(21, 10),
      }),
      false,
    );
    assert.deepEqual(readAs(LEO, 5).playlists, []);
    // Another account's playlists are never carried over.
    const other = keptCommunityPlaylists(before, [], { now: at(21, 9), account: ANA });
    assert.deepEqual(other.playlists, []);
  });

  test("it is stored and read back as it was", () => {
    const kept = {
      ...readAs(LEO, at(20, 9)),
      playlists: [playlist("a"), { ...playlist("b"), author: null, artworkUrl: null }],
    };
    assert.deepEqual(parseKeptCommunityPlaylists(storedKeptCommunityPlaylists(kept)), kept);
    assert.equal(storedKeptCommunityPlaylists(null), null);
  });

  test("nothing stored, or anything unreadable, is no list", () => {
    for (const stored of [
      null,
      "",
      "not json",
      "[]",
      "{}",
      '{"version":2,"readAt":"x","account":"a","playlists":[]}',
      '{"version":2,"readAt":1,"playlists":[]}',
      // A list kept before keys were salted: its home is read again.
      '{"version":1,"readAt":1,"account":"a","playlists":[]}',
      '{"version":3,"readAt":1,"account":"a","playlists":[]}',
    ])
      assert.equal(parseKeptCommunityPlaylists(stored), null, String(stored));
  });

  test("stored entries that aren't playlists are left out", () => {
    const stored = JSON.stringify({
      version: 2,
      readAt: 7,
      account: "abc",
      playlists: [playlist("a"), null, "b", { title: "No id" }, { playlistId: "c", title: "C" }],
    });
    assert.deepEqual(parseKeptCommunityPlaylists(stored), {
      readAt: 7,
      account: "abc",
      playlists: [playlist("a"), { playlistId: "c", title: "C", author: null, artworkUrl: null }],
    });
  });
});

describe("when Home shows Community playlists", () => {
  const kept = readAs(LEO, 1, shelf("One", "a", "b"));

  test("with a connected account and a list kept for it, it shows the list", () => {
    assert.deepEqual(ids(homeCommunityPlaylistsShown(kept, { account: LEO })), ["a", "b"]);
  });

  test("without a connected account it is left out, whatever is kept", () => {
    assert.deepEqual(homeCommunityPlaylistsShown(kept, { account: null }), []);
  });

  test("another account doesn't see the list", () => {
    assert.deepEqual(homeCommunityPlaylistsShown(kept, { account: ANA }), []);
  });

  test("with nothing kept, or an empty list, it is left out", () => {
    assert.deepEqual(homeCommunityPlaylistsShown(null, { account: LEO }), []);
    assert.deepEqual(homeCommunityPlaylistsShown(readAs(LEO, 1), { account: LEO }), []);
  });
});
