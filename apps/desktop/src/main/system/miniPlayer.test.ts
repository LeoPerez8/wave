import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScreenArea, WindowPosition } from "@wave/core";
import { MINI_PLAYER_SIZE, createMiniPlayer, type MiniPlayerWindow } from "./miniPlayer.ts";

const primary: ScreenArea = { x: 0, y: 0, width: 1920, height: 1040 };
const second: ScreenArea = { x: 1920, y: 0, width: 1280, height: 984 };

/** A desk with screens, the stored position and the windows opened on it. */
const desk = (screens: ScreenArea[] = [primary]) => {
  const state = {
    screens,
    stored: undefined as string | undefined,
    windows: [] as {
      position: WindowPosition;
      focused: number;
      closed: boolean;
      emit: (event: "moved" | "close" | "closed") => void;
    }[],
    screensChanged: () => {},
  };
  const start = () =>
    createMiniPlayer({
      areas: () => state.screens,
      stored: () => state.stored,
      store: (value) => {
        state.stored = value;
      },
      onScreensChanged: (listener) => {
        state.screensChanged = listener;
      },
      create: (position): MiniPlayerWindow => {
        const listeners = new Map<string, (() => void)[]>();
        const emit = (event: string) => {
          for (const listener of listeners.get(event) ?? []) listener();
        };
        const opened = { position, focused: 0, closed: false, emit };
        state.windows.push(opened);
        return {
          focus: () => {
            opened.focused++;
          },
          close: () => {
            emit("close");
            opened.closed = true;
            emit("closed");
          },
          position: () => opened.position,
          move: (next) => {
            opened.position = next;
          },
          on: (event, listener) => {
            listeners.set(event, [...(listeners.get(event) ?? []), listener]);
          },
        };
      },
    });
  return { state, start };
};

test("the mini player opens in the first screen's corner, and asking again shows the same window", () => {
  const { state, start } = desk();
  const mini = start();
  assert.equal(mini.isOpen(), false);
  mini.open();
  mini.open();
  assert.equal(state.windows.length, 1);
  assert.deepEqual(state.windows[0]!.position, {
    x: 1920 - MINI_PLAYER_SIZE.width - 24,
    y: 1040 - MINI_PLAYER_SIZE.height - 24,
  });
  assert.equal(state.windows[0]!.focused, 2);
  assert.equal(mini.isOpen(), true);
});

test("it opens where it was dragged to, after a restart too", () => {
  const { state, start } = desk();
  const mini = start();
  mini.open();
  state.windows[0]!.position = { x: 300, y: 200 };
  state.windows[0]!.emit("moved");
  mini.close();
  assert.equal(mini.isOpen(), false);
  mini.open();
  assert.deepEqual(state.windows[1]!.position, { x: 300, y: 200 });
  start().open();
  assert.deepEqual(state.windows[2]!.position, { x: 300, y: 200 });
});

test("a system that never says the window moved still has its position kept when it closes", () => {
  const { state, start } = desk();
  const mini = start();
  mini.open();
  state.windows[0]!.position = { x: 40, y: 60 };
  mini.close();
  start().open();
  assert.deepEqual(state.windows[1]!.position, { x: 40, y: 60 });
});

test("it comes back on screen when the monitor it was on is gone at the next start", () => {
  const { state, start } = desk([primary, second]);
  const mini = start();
  mini.open();
  state.windows[0]!.position = { x: 2500, y: 400 };
  state.windows[0]!.emit("moved");
  mini.close();
  state.screens = [primary];
  start().open();
  assert.deepEqual(state.windows[1]!.position, {
    x: 1920 - MINI_PLAYER_SIZE.width,
    y: 400,
  });
});

test("it comes back on screen when its monitor goes while it is open", () => {
  const { state, start } = desk([primary, second]);
  const mini = start();
  mini.open();
  state.windows[0]!.position = { x: 2500, y: 400 };
  state.windows[0]!.emit("moved");
  state.screens = [primary];
  state.screensChanged();
  assert.deepEqual(state.windows[0]!.position, { x: 1920 - MINI_PLAYER_SIZE.width, y: 400 });
});

test("a screen change with the mini player closed opens nothing", () => {
  const { state, start } = desk();
  const mini = start();
  state.screensChanged();
  mini.open();
  mini.close();
  state.screensChanged();
  assert.equal(state.windows.length, 1);
  assert.equal(state.windows[0]!.closed, true);
});
