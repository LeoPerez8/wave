import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DESKTOP_SHORTCUTS,
  desktopKey,
  shortcutKeys,
  type DesktopCommand,
  type DesktopFocus,
  type DesktopKeyPress,
} from "./desktopKeys.ts";
import { catalogueOf } from "./localisation.ts";

const press = (key: string, mods: Partial<DesktopKeyPress> = {}): DesktopKeyPress => ({
  key,
  ctrl: false,
  alt: false,
  shift: false,
  ...mods,
});
const FOCUSES: readonly DesktopFocus[] = ["field", "slider", "control", "list", "other"];
const everywhere = (key: DesktopKeyPress) => FOCUSES.map((focus) => desktopKey(key, focus));

test("Space plays and pauses unless a button, link, switch or field has focus", () => {
  assert.equal(desktopKey(press(" "), "other"), "playPause");
  assert.equal(desktopKey(press(" "), "list"), "playPause");
  assert.equal(desktopKey(press(" "), "slider"), "playPause");
  assert.equal(desktopKey(press(" "), "control"), undefined);
  assert.equal(desktopKey(press(" "), "field"), undefined);
});

test("↑/↓ move between rows in a list and change the volume elsewhere", () => {
  assert.equal(desktopKey(press("ArrowUp"), "list"), "rowUp");
  assert.equal(desktopKey(press("ArrowDown"), "list"), "rowDown");
  assert.equal(desktopKey(press("ArrowUp"), "other"), "volumeUp");
  assert.equal(desktopKey(press("ArrowDown"), "control"), "volumeDown");
  // A field's caret and a slider's value keep their arrows.
  assert.equal(desktopKey(press("ArrowUp"), "field"), undefined);
  assert.equal(desktopKey(press("ArrowDown"), "slider"), undefined);
});

test("a list's own keys work only while it has focus", () => {
  const listKeys: [DesktopKeyPress, DesktopCommand][] = [
    [press("Enter"), "playRow"],
    [press("Home"), "firstRow"],
    [press("End"), "lastRow"],
    [press("PageUp"), "pageUp"],
    [press("PageDown"), "pageDown"],
    [press("k"), "jump"],
    [press("7"), "jump"],
    [press("F10", { shift: true }), "songMenu"],
    [press("ContextMenu"), "songMenu"],
  ];
  for (const [key, command] of listKeys) {
    assert.equal(desktopKey(key, "list"), command, key.key);
    assert.equal(desktopKey(key, "other"), undefined, key.key);
  }
  assert.equal(desktopKey(press("k", { ctrl: true }), "list"), undefined);
});

test("selection keys work in a list and leave text-field selection alone", () => {
  for (const [key, command] of [
    [press("ArrowUp", { shift: true }), "extendUp"],
    [press("ArrowDown", { shift: true }), "extendDown"],
    [press("a", { ctrl: true }), "selectAllRows"],
  ] as const) {
    assert.equal(desktopKey(key, "list"), command);
    assert.equal(desktopKey(key, "field"), undefined);
    assert.equal(desktopKey(key, "other"), undefined);
  }
});

test("the app's shortcuts work wherever focus is, except where a field edits text", () => {
  assert.deepEqual(everywhere(press("Escape")), Array(5).fill("close"));
  assert.deepEqual(everywhere(press("q", { ctrl: true })), Array(5).fill("quit"));
  assert.deepEqual(everywhere(press("/", { ctrl: true })), Array(5).fill("shortcuts"));
  assert.deepEqual(everywhere(press("F5")), Array(5).fill("rescan"));
  assert.deepEqual(everywhere(press("f", { ctrl: true })), Array(5).fill("search"));
  assert.deepEqual(everywhere(press("L", { ctrl: true, shift: false })), Array(5).fill("favorite"));
  assert.deepEqual(everywhere(press("ArrowLeft", { alt: true })), Array(5).fill("back"));
  assert.deepEqual(everywhere(press("ArrowRight", { alt: true })), Array(5).fill("forward"));
  // Ctrl+←/→ move the caret by words in a field.
  assert.deepEqual(everywhere(press("ArrowRight", { ctrl: true })), [
    undefined,
    "next",
    "next",
    "next",
    "next",
  ]);
  assert.equal(desktopKey(press("ArrowLeft", { ctrl: true }), "list"), "previous");
});

test("Ctrl+/ lists every shortcut, each named in English and Brazilian Portuguese", () => {
  const listed = new Set(DESKTOP_SHORTCUTS.map((shortcut) => shortcut.id));
  const commands: DesktopCommand[] = [];
  for (const focus of FOCUSES)
    for (const key of [
      " ",
      "Enter",
      "Escape",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ContextMenu",
      "F5",
      "F10",
      "a",
      "/",
      "f",
      "l",
      "q",
    ])
      for (const mods of [{}, { ctrl: true }, { alt: true }, { shift: true }]) {
        const command = desktopKey(press(key, mods), focus);
        if (command !== undefined) commands.push(command);
      }
  for (const command of new Set(commands))
    assert.ok(
      listed.has(
        command === "volumeUp" || command === "volumeDown"
          ? "volume"
          : command === "extendUp" || command === "extendDown"
            ? "extendRowSelection"
            : command,
      ),
      command,
    );
  for (const language of ["en", "pt-BR"] as const) {
    const text = catalogueOf(language, "desktop").desktopShortcuts;
    for (const shortcut of DESKTOP_SHORTCUTS) {
      assert.ok(text.labels[shortcut.id].length > 0);
      assert.ok(shortcutKeys(shortcut, text.keys).every((combo) => combo.length > 0));
    }
  }
});

test("each listed key does what the list says", () => {
  const text = catalogueOf("pt-BR", "desktop").desktopShortcuts;
  const play = DESKTOP_SHORTCUTS.find((shortcut) => shortcut.id === "playPause");
  assert.deepEqual(play && shortcutKeys(play, text.keys), ["Espaço"]);
  const menu = DESKTOP_SHORTCUTS.find((shortcut) => shortcut.id === "songMenu");
  assert.deepEqual(menu && shortcutKeys(menu, text.keys), ["Shift+F10", "Menu"]);
  const next = DESKTOP_SHORTCUTS.find((shortcut) => shortcut.id === "next");
  assert.deepEqual(next && shortcutKeys(next, text.keys), ["Ctrl+→"]);
});
