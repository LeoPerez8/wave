import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { playlistRecommendationSession } from "@wave/core";
import { checkRadioDeadlines, withRadioDeadline } from "./radioDeadline.ts";

test("resume fails suspended recommendation work even when its timeout timer never fired", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let released = false;
  const pending = Effect.runPromise(
    Effect.never.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          released = true;
        }),
      ),
      (read) => withRadioDeadline(read, 8000),
    ),
  );
  const failed = assert.rejects(pending, /Radio deadline elapsed/);
  // Jump wall time without delivering timers, as when Android suspends the app.
  t.mock.timers.setTime(892_000);
  checkRadioDeadlines();
  await failed;
  assert.equal(released, true, "expiration interrupts the read and releases its pending work");
});

test("a result delivered after the wall-clock deadline fails before its consumer can publish it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let finish!: () => void;
  const result = Effect.runPromise(
    Effect.callback<string>((resume) => {
      finish = () => resume(Effect.succeed("late recommendations"));
    }).pipe((read) => withRadioDeadline(read, 8000)),
  );
  const failed = assert.rejects(result, /Radio deadline elapsed/);
  t.mock.timers.setTime(8000);
  finish();
  await failed;
});

test("a suspended playlist read leaves loading in its failure state and can be retried", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let hung = true;
  const session = playlistRecommendationSession({
    newId: () => "offer",
    read: () =>
      Effect.runPromise(
        (hung
          ? Effect.never
          : Effect.succeed({
              playlist: [],
              sources: { library: [], catalog: [], graph: null, now: Date.now() },
            })
        ).pipe((read) => withRadioDeadline(read, 8000)),
      ),
    dismiss: async () => {},
  });
  t.after(session.dispose);
  const pending = session.renew();
  t.mock.timers.setTime(892_000);
  checkRadioDeadlines();
  await pending;
  assert.equal(session.get().loading, false);
  assert.equal(session.get().error, "load");
  hung = false;
  await session.renew();
  assert.equal(session.get().loading, false);
  assert.equal(session.get().error, null);
});

test("normal completion and cancellation release the deadline, and later reads have their own limit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  assert.equal(
    await Effect.runPromise(Effect.succeed("saved").pipe((read) => withRadioDeadline(read, 8000))),
    "saved",
  );
  const controller = new AbortController();
  const pending = Effect.runPromise(
    Effect.never.pipe((read) => withRadioDeadline(read, 8000)),
    {
      signal: controller.signal,
    },
  );
  const stopped = assert.rejects(pending);
  controller.abort();
  await stopped;
  t.mock.timers.tick(8000);
  checkRadioDeadlines();
  assert.equal(
    await Effect.runPromise(Effect.succeed("fresh").pipe((read) => withRadioDeadline(read, 8000))),
    "fresh",
  );
  const later = Effect.runPromise(Effect.never.pipe((read) => withRadioDeadline(read, 8000)));
  const failed = assert.rejects(later, /Radio deadline elapsed/);
  t.mock.timers.tick(8000);
  await failed;
});
