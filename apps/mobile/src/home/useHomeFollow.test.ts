import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";
import type { HomeFollowSnapshot } from "@wave/core";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const boundary = `data:text/javascript,${encodeURIComponent(`
  import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
  let visible = true;
  const listeners = new Set();
  export const sight = { visible: () => visible, subscribe: (f) => { listeners.add(f); return () => listeners.delete(f); } };
  export const show = (value) => { visible = value; for (const f of listeners) f(value); };
  export const useScreenSight = () => sight;
  export const everyWhileInSight = () => () => {};
  export const useFollowedArtistsEnabled = () => true;
  export const useDontPlayExplicit = () => false;
  export const useYtMusicEnabled = () => false;
  export const currentFollowCountry = () => saved.country;
  export const followCountry = { useValue: () => {} };
  export let saved = { follows: [], releases: [], shows: [], country: "BR" };
  export const save = (value) => { saved = value; };
  export const knownHomeFollow = { get: () => ({ follows: [], releases: [], shows: [], country: "BR" }) };
  export const readHomeFollowForVisit = async (admitted) => admitted ? { ...saved, follows: admitted.follows } : saved;
  export const checkFollowReleases = () => Effect.succeed(false);
  export const followsSaved = { subscribe: () => () => {} };
  export const LibraryStore = Effect.succeed({ listeningHistoryVersion: { subscribe: () => () => {} } });
  export const appRuntime = { runPromise: Effect.runPromise };
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/") || ["./knownHomeFollow", "./followReleases"].includes(specifier))
      return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
});
const { HomeFollowProvider, useHomeFollow, useHomeFollowPresence } =
  await import("./useHomeFollow.ts");
const io = await import(boundary);
hooks.deregister();

test("returning Home admits saved follows and country, while refreshes during a visit keep its follows", async () => {
  let current: ReturnType<typeof useHomeFollow> | undefined;
  let presenceRenders = 0;
  function Cards() {
    const value = useHomeFollow();
    useLayoutEffect(() => {
      current = value;
    });
    return null;
  }
  function OrdinarySection() {
    assert.equal(useHomeFollowPresence(), true);
    useLayoutEffect(() => {
      presenceRenders++;
    });
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      renderer = create(
        createElement(
          HomeFollowProvider,
          null,
          createElement(Cards),
          createElement(OrdinarySection),
        ),
      );
    });
    const firstPresenceRenders = presenceRenders;
    const follow = {
      key: "abba",
      name: "ABBA",
      level: "shows" as const,
      followedAt: 1,
      deezerId: null,
      ytBrowseId: null,
    };
    const changed: HomeFollowSnapshot = {
      follows: [follow],
      releases: [],
      shows: [],
      country: "US",
    };
    io.save(changed);
    await act(async () => {
      current!.refresh();
    });
    assert.deepEqual(current!.follows, []);
    await act(async () => {
      io.show(false);
    });
    await act(async () => {
      io.show(true);
    });
    assert.deepEqual(current!.follows, [follow]);
    assert.equal(
      presenceRenders,
      firstPresenceRenders,
      "ordinary sections do not follow feed refreshes",
    );
    io.save({ ...changed, follows: [{ ...follow, level: "releases" }] });
    await act(async () => {
      io.show(false);
    });
    await act(async () => {
      io.show(true);
    });
    assert.equal((current!.follows as HomeFollowSnapshot["follows"])[0]?.level, "releases");
  } finally {
    act(() => renderer?.unmount());
  }
});
