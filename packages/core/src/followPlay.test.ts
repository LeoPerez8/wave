import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catalogueOf,
  followPlaySources,
  followPlayStep,
  followQueueLabel,
  type FollowRelease,
} from "./index.ts";

const en = catalogueOf("en");
const ptBR = catalogueOf("pt-BR");

const release = (key: string, over: Partial<FollowRelease> = {}): FollowRelease => ({
  key,
  artistKey: "abba",
  title: key,
  type: "album",
  releaseDate: "2026-10-01",
  artworkUrl: null,
  explicit: false,
  browseId: null,
  videoIds: [],
  recordingKeys: [],
  ...over,
});

test("Play plays the section's releases in its order: the Library's album, else the YT Music match", () => {
  const cards = [
    release("newest", { browseId: "MPREb_new" }),
    release("owned", { libraryAlbumId: 7, browseId: "MPREb_owned" }),
    release("unmatched"),
  ];
  assert.deepEqual(followPlaySources(cards, { ytMusic: true }), [
    { kind: "yt", key: "newest", browseId: "MPREb_new" },
    { kind: "library", key: "owned", albumId: 7 },
  ]);
  assert.deepEqual(followPlaySources(cards, { ytMusic: false }), [
    { kind: "library", key: "owned", albumId: 7 },
  ]);
});

test("the first release read starts the queue, the rest join it in order, and a failed one is left out", () => {
  const id = "play-1";
  const ours = { kind: "newReleases", id };
  assert.equal(followPlayStep({ started: false, context: null, id }, null), "skip");
  assert.equal(followPlayStep({ started: false, context: null, id }, 0), "skip");
  assert.equal(followPlayStep({ started: false, context: null, id }, 3), "play");
  assert.equal(followPlayStep({ started: true, context: ours, id }, 2), "append");
  assert.equal(followPlayStep({ started: true, context: ours, id }, null), "skip");
  // Something else took the queue (or Undo brought the old one back): the rest stay out.
  assert.equal(
    followPlayStep({ started: true, context: { kind: "album", id: "4" }, id }, 2),
    "stop",
  );
  assert.equal(followPlayStep({ started: true, context: { kind: "newReleases", id: "x" }, id }, 2), "stop");
});

test("Up Next says the queue came from the section", () => {
  const context = { kind: "newReleases", id: "play-1" };
  assert.equal(followQueueLabel(context, en), "Up next · from New from Artists You Follow");
  assert.equal(followQueueLabel(context, ptBR), "A seguir · de Novidades dos Artistas que Você Segue");
  assert.equal(followQueueLabel({ kind: "album", id: "1" }, en), null);
  assert.equal(followQueueLabel(null, en), null);
});
