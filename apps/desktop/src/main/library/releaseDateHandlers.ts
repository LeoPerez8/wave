/** Main's side of `window.wave.releaseDates`: the song and the typed date, checked before use. */
import { Database } from "@wave/client";
import type { TypedReleaseDateFields } from "@wave/core";
import * as Effect from "effect/Effect";
import type { BridgeContract } from "../../shared/bridge.ts";
import type { RELEASE_DATE_CALLS } from "../../shared/releaseDates.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import { Account } from "../account/accountLayer.ts";
import { Playback } from "../playback/playback.ts";
import { VIDEO_ID, YtMusic } from "../yt/ytMusic.ts";
import {
  libraryReleaseSong,
  releaseDateView,
  saveReleaseDate,
  streamedReleaseSong,
  type ReleaseDateSong,
} from "./releaseDates.ts";
import { targetEntries } from "./songActions.ts";

type Call = (typeof RELEASE_DATE_CALLS)[number];
type Handlers = {
  readonly [C in Call]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, Account | Database | Playback | YtMusic>;
};

const refuse = (call: Call, why: string) => Effect.fail(new Error(`Refused ${call}: ${why}`));

/** What the three fields hold as typed: short strings, which Core's rule reads. */
const typedFields = (value: unknown): value is TypedReleaseDateFields => {
  if (typeof value !== "object" || value === null) return false;
  const { year, month, day } = value as TypedReleaseDateFields;
  return [year, month, day].every((field) => typeof field === "string" && field.length <= 8);
};

const pad = (n: number) => String(n).padStart(2, "0");
/** The computer's date today, `YYYY-MM-DD`: a date still to come is refused. */
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export const releaseDateHandlers = (validTarget: (value: unknown) => value is SongTarget) => {
  const valid = (song: unknown) =>
    (typeof song === "string" && VIDEO_ID.test(song)) || validTarget(song);
  /** The one song [subject] names: a menu's Library song or playlist entry, or a streamed song. */
  const songOf = (subject: SongTarget | string) =>
    Effect.gen(function* () {
      const db = yield* Database;
      if (typeof subject === "string") {
        const song = (yield* YtMusic).song(subject);
        if (song === undefined)
          return yield* Effect.fail(new Error("[yt-unknown] That song isn't known anymore"));
        return streamedReleaseSong(db, song);
      }
      const entries = targetEntries(db, subject);
      const entry = entries[0];
      const song: ReleaseDateSong | undefined =
        entries.length !== 1 || entry === undefined
          ? undefined
          : "trackId" in entry
            ? libraryReleaseSong(db, entry.trackId)
            : streamedReleaseSong(db, entry.song);
      if (song === undefined) return yield* Effect.fail(new Error("Release Date takes one song"));
      return song;
    });
  const handlers: Handlers = {
    "releaseDates.view": ([song]) =>
      valid(song)
        ? Effect.gen(function* () {
            return releaseDateView(yield* Database, yield* songOf(song as SongTarget | string));
          })
        : refuse("releaseDates.view", "invalid song"),
    "releaseDates.save": ([song, fields]) =>
      valid(song) && (fields === null || typedFields(fields))
        ? Effect.gen(function* () {
            const db = yield* Database;
            const saved = saveReleaseDate(
              db,
              yield* songOf(song as SongTarget | string),
              fields,
              today(),
              Date.now(),
            );
            if (saved.ok) {
              // The typed dates are synced preferences: the account sends them to the phone.
              (yield* Account).settingsEdited();
              // The window reads its rows again: a playlist sorted by release date moves the song.
              (yield* Playback).refresh();
            }
            return saved;
          })
        : refuse("releaseDates.save", "invalid song or date"),
  };
  return handlers;
};
