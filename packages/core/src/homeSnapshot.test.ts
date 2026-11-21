import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HOME_SNAPSHOT_MAX_LENGTH,
  homeSnapshotList,
  homeSnapshotRecord,
  parseHomeSnapshot,
  storedHomeSnapshot,
  type HomeSnapshotChecks,
} from "./index.ts";

interface Sections {
  readonly songs: readonly { readonly id: number; readonly title: string }[];
  readonly facts: { readonly label: string };
}

const checks: HomeSnapshotChecks<Sections> = {
  songs: homeSnapshotList({ id: "number", title: "string" }),
  facts: homeSnapshotRecord({ label: "string" }),
};

const songs = [
  { id: 1, title: "Paranoid Android" },
  { id: 2, title: "Karma Police" },
];

test("a stored snapshot reads back with its sections, its time and the page in sight", () => {
  const stored = storedHomeSnapshot<Sections>({
    savedAt: 1_700_000_000_000,
    page: 2,
    sections: { songs, facts: { label: "Songs" } },
  });
  assert.deepEqual(parseHomeSnapshot(stored, checks), {
    savedAt: 1_700_000_000_000,
    page: 2,
    sections: { songs, facts: { label: "Songs" } },
  });
});

test("a section not yet answered stays out of the snapshot", () => {
  const stored = storedHomeSnapshot<Sections>({ savedAt: 5, page: null, sections: { songs } });
  assert.deepEqual(parseHomeSnapshot(stored, checks), {
    savedAt: 5,
    page: null,
    sections: { songs },
  });
});

test("nothing stored, unreadable text or another format reads as no snapshot", () => {
  assert.equal(parseHomeSnapshot(null, checks), null);
  assert.equal(parseHomeSnapshot("{not json", checks), null);
  assert.equal(parseHomeSnapshot("[1,2]", checks), null);
  assert.equal(
    parseHomeSnapshot(JSON.stringify({ version: 0, savedAt: 5, sections: { songs } }), checks),
    null,
  );
  assert.equal(
    parseHomeSnapshot(JSON.stringify({ version: 1, sections: { songs } }), checks),
    null,
  );
});

test("a section that doesn't hold what Home draws is left out; the others still show", () => {
  const stored = JSON.stringify({
    version: 1,
    savedAt: 5,
    page: 1,
    sections: {
      songs: [{ id: "1", title: "Paranoid Android" }],
      facts: { label: "Songs" },
      gone: [1, 2, 3],
    },
  });
  assert.deepEqual(parseHomeSnapshot(stored, checks), {
    savedAt: 5,
    page: 1,
    sections: { facts: { label: "Songs" } },
  });
});

test("a page that isn't a place among pages reads as none", () => {
  const stored = JSON.stringify({ version: 1, savedAt: 5, page: -1, sections: { songs } });
  assert.equal(parseHomeSnapshot(stored, checks)?.page, null);
  const fraction = JSON.stringify({ version: 1, savedAt: 5, page: 1.5, sections: { songs } });
  assert.equal(parseHomeSnapshot(fraction, checks)?.page, null);
});

test("a snapshot over the size bound isn't kept", () => {
  const long = Array.from({ length: HOME_SNAPSHOT_MAX_LENGTH / 10 }, (_, id) => ({
    id,
    title: "A long title",
  }));
  assert.equal(
    storedHomeSnapshot<Sections>({ savedAt: 5, page: null, sections: { songs: long } }),
    null,
  );
});

test("a snapshot with nothing answered isn't kept", () => {
  assert.equal(storedHomeSnapshot<Sections>({ savedAt: 5, page: 0, sections: {} }), null);
});

test("a list check accepts nullable fields only where it says so", () => {
  const check = homeSnapshotList({ id: "number", art: "string?" });
  assert.equal(check([{ id: 1, art: null }]), true);
  assert.equal(check([{ id: 1 }]), true);
  assert.equal(check([{ id: 1, art: 3 }]), false);
  assert.equal(check([null]), false);
  assert.equal(check({ id: 1 }), false);
});
