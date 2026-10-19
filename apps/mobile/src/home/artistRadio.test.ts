/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_ARTIST_RADIO_STARTS,
  artistRadioStart,
  withArtistRadioStart,
  type ArtistRadioStarts,
  type YtRadioStart,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { artistRadioReader } from "./artistRadio.ts";

const page = (name: string) => ({ songs: [], continuation: name });
const remembered = { playlistId: "RDEMold", params: "wAEB" };
const fresh = { playlistId: "RDEMnew", params: null };

type Failure = { readonly reason: "offline" | "failed" | "disabled" };

/** A reader over fake YouTube Music answers, saying which reads it made. */
const reader = (
  initial: ArtistRadioStarts,
  answers: {
    readonly fromStart?: Failure;
    readonly fromPage?: Failure;
  } = {},
) => {
  let starts = initial;
  const reads: string[] = [];
  const read = artistRadioReader({
    starts: { get: () => starts, set: (next) => (starts = next) },
    fromStart: (start: YtRadioStart) => {
      reads.push(`start ${start.playlistId}`);
      return answers.fromStart === undefined
        ? Effect.succeed(page("from start"))
        : Effect.fail(answers.fromStart);
    },
    fromPage: (browseId: string) => {
      reads.push(`page ${browseId}`);
      return answers.fromPage === undefined
        ? Effect.succeed({ ...page("from page"), start: fresh })
        : Effect.fail(answers.fromPage);
    },
  });
  return { read, reads, starts: () => starts };
};

const knowing = withArtistRadioStart(NO_ARTIST_RADIO_STARTS, "UC1", remembered);

describe("An artist's radio", () => {
  test("with a remembered start doesn't read the artist page", async () => {
    const { read, reads } = reader(knowing);
    const radio = await Effect.runPromise(read("UC1"));
    assert.deepEqual(radio, page("from start"));
    assert.deepEqual(reads, ["start RDEMold"]);
  });

  test("without one reads the page and remembers where the radio started", async () => {
    const { read, reads, starts } = reader(NO_ARTIST_RADIO_STARTS);
    const radio = await Effect.runPromise(read("UC1"));
    assert.deepEqual(radio, page("from page"));
    assert.deepEqual(reads, ["page UC1"]);
    assert.deepEqual(artistRadioStart(starts(), "UC1"), fresh);
  });

  test("whose start YouTube Music refuses reads the page once and remembers its start", async () => {
    const { read, reads, starts } = reader(knowing, { fromStart: { reason: "failed" } });
    const radio = await Effect.runPromise(read("UC1"));
    assert.deepEqual(radio, page("from page"));
    assert.deepEqual(reads, ["start RDEMold", "page UC1"]);
    assert.deepEqual(artistRadioStart(starts(), "UC1"), fresh);
  });

  test("whose start is refused and whose page fails forgets the start", async () => {
    const { read, reads, starts } = reader(knowing, {
      fromStart: { reason: "failed" },
      fromPage: { reason: "failed" },
    });
    const radio = await Effect.runPromise(Effect.result(read("UC1")));
    assert.ok(Result.isFailure(radio));
    assert.deepEqual(reads, ["start RDEMold", "page UC1"]);
    assert.equal(artistRadioStart(starts(), "UC1"), null);
  });

  test("offline, or with YT Music off, fails without the page and keeps the start", async () => {
    for (const reason of ["offline", "disabled"] as const) {
      const { read, reads, starts } = reader(knowing, { fromStart: { reason } });
      const radio = await Effect.runPromise(Effect.result(read("UC1")));
      assert.deepEqual(radio, Result.fail({ reason }));
      assert.deepEqual(reads, ["start RDEMold"]);
      assert.deepEqual(artistRadioStart(starts(), "UC1"), remembered);
    }
  });
});
