import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";
import type { SongLinkSetup } from "@wave/core";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const boundary = `data:text/javascript,${encodeURIComponent(`
  import { useEffect, useState } from ${JSON.stringify(import.meta.resolve("react"))};
  const listeners = new Set();
  export const AppState = {
    addEventListener(_name, listener) {
      listeners.add(listener);
      return { remove() { listeners.delete(listener); } };
    },
  };
  export const changeAppState = (state) => { for (const listener of listeners) listener(state); };
  export const phone = { state: { allowed: true, hosts: { "music.youtube.com": 0 } } };
  export const WaveNative = {
    songLinkHandling: () => phone.state,
    songLinkOpeners: () => null,
  };
  let language = "en";
  const languageListeners = new Set();
  export const setLanguage = (next) => { language = next; for (const listener of languageListeners) listener(); };
  export const useLocalisation = () => {
    const [, rerender] = useState(0);
    useEffect(() => {
      const listener = () => rerender((count) => count + 1);
      languageListeners.add(listener);
      return () => languageListeners.delete(listener);
    }, []);
    return { language };
  };
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react-native" || specifier.startsWith("@/"))
      return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
});
const { useSongLinkSetup } = await import("./songLinkHandling.ts");
const io = await import(boundary);
hooks.deregister();

const mount = () => {
  const seen: (SongLinkSetup | null)[] = [];
  function Probe() {
    const setup = useSongLinkSetup();
    useLayoutEffect(() => {
      seen.push(setup);
    });
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(Probe));
  });
  return { seen, unmount: () => act(() => renderer?.unmount()) };
};

test("the setup is read on mount and again when Wave returns to the foreground", () => {
  io.phone.state = { allowed: true, hosts: { "music.youtube.com": 0 } };
  const { seen, unmount } = mount();
  assert.equal(seen.at(-1)?.handling, "none");

  // The owner turns the host on in Android's Open by default page, then comes back.
  io.phone.state = { allowed: true, hosts: { "music.youtube.com": 1 } };
  act(() => io.changeAppState("background"));
  assert.equal(seen.at(-1)?.handling, "none");
  act(() => io.changeAppState("active"));
  assert.equal(seen.at(-1)?.handling, "all");
  assert.equal(seen.at(-1)?.line, "On: YouTube Music, Spotify and Deezer links open in Wave.");
  unmount();
});

test("the line follows a language switch without leaving Wave", () => {
  io.phone.state = { allowed: true, hosts: { "music.youtube.com": 2 } };
  const { seen, unmount } = mount();
  act(() => io.setLanguage("pt-BR"));
  assert.equal(
    seen.at(-1)?.line,
    "Ativado: links do YouTube Music, Spotify e Deezer abrem no Wave.",
  );
  act(() => io.setLanguage("en"));
  unmount();
});
