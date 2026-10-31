import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePlaylistOfferOrder,
  parseSavedPlaylistOffers,
  PLAYLIST_SAVED_OFFERS,
  playlistOfferGone,
  playlistOfferHeld,
  playlistOfferOrderWith,
  playlistOffersToSave,
  playlistOffersToShow,
  playlistOffersWithout,
  playlistOffersHaveRoom,
  playlistOffersWithSpares,
  storedPlaylistOfferOrder,
  storedSavedPlaylistOffers,
  type PlaylistRecommendationTrack,
} from "./index.ts";

const track = (
  id: string,
  extra: Partial<PlaylistRecommendationTrack> = {},
): PlaylistRecommendationTrack => ({
  id,
  source: "library",
  videoId: "",
  title: `Title ${id}`,
  artists: [`Artist ${id}`],
  album: "Album",
  albumId: null,
  durationMs: 180_000,
  artworkUrl: null,
  explicit: false,
  genre: "Rock",
  ...extra,
});
const ids = (tracks: readonly PlaylistRecommendationTrack[]) => tracks.map((t) => t.id);
const letters = (text: string) => text.split("").map((id) => track(id));

const onlineBeside = (shown: readonly PlaylistRecommendationTrack[]) => ({ shown, online: true });

test("a renewal saves the five it would show, then spares in ranked order, twenty at most", () => {
  const saved = playlistOffersToSave([], letters("abcdefghijklmnopqrstuvwxyz"), { online: true });
  assert.equal(PLAYLIST_SAVED_OFFERS, 20);
  assert.deepEqual(ids(saved), ids(letters("abcdefghijklmnopqrst")));
});

test("the artist cap can't crowd out the five offers: they're saved ahead of same-artist spares", () => {
  const same = (id: string) => track(id, { artists: ["Same Artist"] });
  const ranked = [
    ..."abcdefghijklmnopqrstuvw".split("").map(same),
    track("x"),
    track("y"),
    track("z"),
  ];
  const saved = playlistOffersToSave([], ranked, { online: true });
  assert.deepEqual(ids(playlistOffersToShow(saved, { online: true })), ["a", "b", "x", "y", "z"]);
  assert.equal(saved.length, 20);
  // Still in ranked order, so what shows comes out the same however it's filtered.
  assert.deepEqual(ids(saved), [..."abcdefghijklmnopq".split(""), "x", "y", "z"]);
});

test("a renewal made offline or finding nothing leaves what's saved", () => {
  const before = letters("abc");
  assert.equal(playlistOffersToSave(before, letters("xyz"), { online: false }), before);
  assert.equal(playlistOffersToSave(before, [], { online: true }), before);
  assert.deepEqual(ids(playlistOffersToSave([], letters("xy"), { online: false })), ["x", "y"]);
});

test("a visit shows the first five saved offers that fit, in their saved order", () => {
  assert.deepEqual(ids(playlistOffersToShow(letters("abcdefg"), { online: true })), [
    "a",
    "b",
    "c",
    "d",
    "e",
  ]);
});

test("offline, saved streamed offers stay hidden and Library files show", () => {
  const stream = (id: string) => track(id, { source: "stream", videoId: `v${id}` });
  const saved = [stream("a"), track("b"), stream("c"), track("d")];
  assert.deepEqual(ids(playlistOffersToShow(saved, { online: false })), ["b", "d"]);
  assert.deepEqual(ids(playlistOffersToShow(saved, { online: true })), ["a", "b", "c", "d"]);
});

test("a saved Library song with no file isn't shown", () => {
  const saved = [track("a", { available: false }), track("b")];
  assert.deepEqual(ids(playlistOffersToShow(saved, { online: true })), ["b"]);
});

test("a song added or dismissed leaves the saved offers, any recording of it", () => {
  const saved = [
    track("a", { videoId: "va" }),
    track("b"),
    track("c", { title: "Same Song", artists: ["Same Artist"] }),
  ];
  const left = playlistOffersWithout(saved, [
    track("other", { videoId: "va" }),
    track("yt:c", { source: "stream", title: "Same Song", artists: ["Same Artist"] }),
  ]);
  assert.deepEqual(ids(left), ["b"]);
});

test("an offer is gone once the playlist holds it", () => {
  const gone = playlistOfferGone([track("a")], { library: [] });
  assert.equal(gone(track("a")), true);
  assert.equal(gone(track("b")), false);
});

test("an offer is gone once dismissed for this playlist, unless the playlist accepted it since", () => {
  const dismissed = track("a");
  const backAgain = track("b");
  const gone = playlistOfferGone([], {
    library: [],
    feedback: [
      { track: dismissed, value: -1 },
      { track: backAgain, value: -1 },
      { track: backAgain, value: 1 },
    ],
  });
  assert.equal(gone(dismissed), true);
  assert.equal(gone(backAgain), false);
});

test("a Library offer is gone once its file is, but not while the Library isn't read yet", () => {
  const library = [track("a"), track("missing", { available: false })];
  const gone = playlistOfferGone([], { library });
  assert.equal(gone(track("a")), false);
  assert.equal(gone(track("left")), true);
  assert.equal(gone(track("missing")), true);
  assert.equal(gone(track("yt:x", { source: "stream", videoId: "x" })), false);
  assert.equal(playlistOfferGone([], { library: [] })(track("left")), false);
});

test("an offer is held by a playlist's entries by Library id or video id", () => {
  const library = track("7");
  const stream = track("yt:v1", { source: "stream", videoId: "v1" });
  const sameVideo = track("8", { videoId: "v1" });
  const elsewhere = track("9");
  const held = playlistOfferHeld(
    [library, stream, sameVideo, elsewhere],
    [{ id: "7" }, { videoId: "v1" }, { videoId: "" }, {}],
    (entry: { id?: string }) => entry.id,
    (entry: { videoId?: string }) => entry.videoId,
  );
  assert.equal(held(library), true);
  assert.equal(held(stream), true);
  assert.equal(held(sameVideo), true);
  assert.equal(held(elsewhere), false, "an offer without a video id matches no entry by it");
});

test("checking offers reads each entry's ids once and keeps no copy of the entries", () => {
  let reads = 0;
  const entries = Array.from({ length: 1000 }, (_, id) => id);
  const held = playlistOfferHeld(
    [track("999")],
    entries,
    (entry) => {
      reads++;
      return String(entry);
    },
    () => undefined,
  );
  assert.equal(reads, 1000);
  assert.equal(held(track("999")), true);
  assert.equal(held(track("5")), false, "only the offers asked about are known");
  assert.equal(reads, 1000);
});

test("saved offers and each's row read back as they were stored", () => {
  const offers = [
    { track: track("a", { favorite: true, genres: ["Rock"] }), row: { id: 1 } },
    { track: track("yt:b", { source: "stream", videoId: "b", durationMs: null }) },
  ];
  assert.deepEqual(parseSavedPlaylistOffers(storedSavedPlaylistOffers(offers)), offers);
});

test("unreadable saved offers count as nothing saved", () => {
  for (const text of [null, "", "not json", "{}", "12", '[{"track":{"id":1}}]', "[null]"])
    assert.deepEqual(parseSavedPlaylistOffers(text), [], String(text));
});

test("an offer that can't be read drops alone", () => {
  const good = { track: track("a") };
  const text = JSON.stringify([good, { track: { ...track("b"), artists: "x" } }]);
  assert.deepEqual(parseSavedPlaylistOffers(text), [good]);
});

test("an offer saved without a field every track now has drops alone", () => {
  const good = { track: track("a") };
  const { durationMs: _gone, ...older } = track("b");
  const text = JSON.stringify([good, { track: older }]);
  assert.deepEqual(parseSavedPlaylistOffers(text), [good]);
});

test("the latest 200 playlists keep their saved offers", () => {
  let order: readonly number[] = [];
  for (let id = 0; id < 200; id++) {
    const next = playlistOfferOrderWith(order, id);
    assert.deepEqual(next.dropped, []);
    order = next.order;
  }
  // The oldest leaves; saving an older one again moves it to the latest.
  const again = playlistOfferOrderWith(order, 0);
  assert.deepEqual(again.dropped, []);
  assert.equal(again.order.at(-1), 0);
  const more = playlistOfferOrderWith(again.order, 200);
  assert.deepEqual(more.dropped, [1]);
  assert.equal(more.order.length, 200);
  assert.deepEqual(parsePlaylistOfferOrder(storedPlaylistOfferOrder(more.order)), more.order);
});

test("an unreadable order reads as none", () => {
  for (const text of [null, "not json", "{}", '["a"]'])
    assert.deepEqual(parsePlaylistOfferOrder(text), [], String(text));
});

test("spares from a later radio go after what's saved, with no second recording and at most 20", () => {
  const saved = [track("a"), track("b")];
  assert.deepEqual(
    playlistOffersWithSpares(saved, [track("b"), track("c")], onlineBeside(saved)).map(
      (offer) => offer.id,
    ),
    ["a", "b", "c"],
  );
  assert.equal(playlistOffersWithSpares(saved, [track("a")], onlineBeside(saved)), saved);
  const full = Array.from({ length: 20 }, (_, index) => track(`t${index}`));
  assert.equal(playlistOffersWithSpares(full, [track("c")], onlineBeside(full.slice(0, 5))), full);
});

test("a full reserve makes room for usable offers by dropping the last it can't use", () => {
  const library = Array.from({ length: 5 }, (_, index) => track(`s${index}`));
  const hidden = Array.from({ length: 15 }, (_, index) =>
    track(`h${index}`, { source: "stream", videoId: `h${index}` }),
  );
  const saved = [...library, ...hidden];
  const next = playlistOffersWithSpares(saved, [track("n1"), track("n2")], {
    shown: library,
    online: false,
  });
  assert.deepEqual(
    next.map((offer) => offer.id),
    [...saved.slice(0, 18).map((offer) => offer.id), "n1", "n2"],
  );
  assert.equal(
    playlistOffersWithSpares(saved, [track("n1")], { shown: library, online: true }),
    saved,
    "online they can all step in",
  );
});

const band = (id: string) => track(id, { artists: ["Band"] });
const bandShowing = [band("b1"), band("b2"), track("s1"), track("s2"), track("s3")];
const bandSpares = Array.from({ length: 15 }, (_, index) => band(`c${index}`));

test("spares that break the artist cap give way; the offers showing never do", () => {
  const next = playlistOffersWithSpares([...bandShowing, ...bandSpares], [track("n1")], {
    shown: bandShowing,
    online: true,
  });
  assert.deepEqual(next.slice(0, 5), bandShowing);
  assert.deepEqual(
    next.slice(5).map((offer) => offer.id),
    [...bandSpares.slice(0, 14).map((offer) => offer.id), "n1"],
  );
});

test("in a full reserve a new offer that couldn't step in finds no room, and one just shown does", () => {
  const saved = [...bandShowing, ...bandSpares];
  const context = { shown: bandShowing, online: true };
  assert.equal(playlistOffersWithSpares(saved, [band("n")], context), saved);
  const taken = track("taken");
  const next = playlistOffersWithSpares(saved, [taken], {
    shown: [...bandShowing, taken],
    online: true,
  });
  assert.equal(next.includes(taken), true);
  assert.equal(next.length, 20);
});

test("a reserve has room until it's full of offers showing or able to step in", () => {
  const library = Array.from({ length: 5 }, (_, index) => track(`s${index}`));
  const spares = Array.from({ length: 15 }, (_, index) =>
    track(`h${index}`, { source: "stream", videoId: `h${index}` }),
  );
  const full = [...library, ...spares];
  assert.equal(playlistOffersHaveRoom(full, { shown: library, online: true }), false);
  assert.equal(playlistOffersHaveRoom(full, { shown: library, online: false }), true);
  assert.equal(playlistOffersHaveRoom(library, { shown: library, online: true }), true);
});
