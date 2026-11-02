import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const native = `data:text/javascript,${encodeURIComponent(`
  export const AppState = {};
  const listeners = new Map();
  export const Keyboard = {
    dismiss() {},
    addListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
      return { remove() { listeners.get(name).delete(listener); } };
    },
  };
  export const emitKeyboard = name => {
    for (const listener of listeners.get(name) ?? []) listener();
  };
`)}`;
const expo =
  "data:text/javascript,export class NativeModule {}; export const requireOptionalNativeModule = () => null;";
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react-native") return { url: native, shortCircuit: true };
    if (specifier === "expo") return { url: expo, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const overlay = await import("./overlay.ts");
const { usePlaylistPickerSearch } = await import("../library/usePlaylistPickerSearch.ts");
const { useOverlayCardFrame } = await import("./useOverlayCardFrame.ts");
const { emitKeyboard } = await import(native);
hooks.deregister();

test("Back closes search first; choosing and the veil keep search while dismissing the keyboard", () => {
  let entries: ReturnType<typeof overlay.useOverlayEntries> = [];
  function Cards() {
    entries = overlay.useOverlayEntries();
    return null;
  }
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Cards));
  });
  try {
    let handle: ReturnType<typeof overlay.openOverlay>;
    act(() => {
      handle = overlay.openOverlay({ label: "Picker", render: () => null });
    });
    const id = entries.at(-1)!.id;
    let closedSearch = 0;
    const search = {
      dismissKeyboard: () => {},
      close: () => {
        closedSearch++;
        overlay.setOverlaySearch(id, undefined);
      },
    };
    act(() => overlay.setOverlaySearch(id, search));
    act(() => {
      assert.equal(overlay.dismissTopOverlay(), true);
    });
    assert.equal(closedSearch, 1);
    assert.equal(overlay.isOverlayOpen(), true);
    act(() => {
      assert.equal(overlay.dismissTopOverlay(), true);
    });
    assert.equal(overlay.isOverlayOpen(), false);
    act(() => overlay.removeOverlay(id));

    for (const viaVeil of [false, true]) {
      let dismissed = false;
      let keyboardDismissed = false;
      act(() => {
        handle = overlay.openOverlay({
          label: "Picker",
          render: () => null,
          onDismiss: () => {
            dismissed = true;
          },
        });
      });
      const nextId = entries.at(-1)!.id;
      const searching = {
        close: () => {
          closedSearch++;
        },
        dismissKeyboard: () => {
          keyboardDismissed = true;
        },
      };
      act(() => overlay.setOverlaySearch(nextId, searching));
      act(() => {
        if (viaVeil) overlay.dismissOverlay(entries.at(-1)!);
        else handle!.close();
      });
      assert.equal(closedSearch, 1, "the filtered list stays while the card fades");
      assert.equal(keyboardDismissed, true);
      assert.equal(entries.at(-1)!.search, searching);
      assert.equal(entries.at(-1)!.closing, true);
      assert.equal(dismissed, viaVeil);
      act(() => overlay.removeOverlay(nextId));
    }
  } finally {
    act(() => {
      overlay.dismissAllOverlays();
      for (const entry of entries) overlay.removeOverlay(entry.id);
      renderer!.unmount();
    });
  }
});

test("a searching card retains its placement and height when the keyboard hides during fade-out", () => {
  let closing = false;
  let keyboard = 0;
  let frame: ReturnType<typeof useOverlayCardFrame>;
  function Card() {
    const placed = useOverlayCardFrame(
      {
        window: { width: 800, height: 360 },
        insets: { top: 24, bottom: 0, left: 0, right: 0 },
        margin: 24,
        maxWidth: 480,
        cardHeight: 600,
        searching: true,
        keyboard,
      },
      closing,
    );
    useLayoutEffect(() => {
      frame = placed;
    });
    return null;
  }
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Card));
  });
  try {
    assert.equal(frame!.maxHeight, 288);
    keyboard = 190;
    act(() => renderer!.update(createElement(Card)));
    assert.equal(frame!.maxHeight, 98);
    const searchingFrame = frame!;
    closing = true;
    keyboard = 0;
    act(() => renderer!.update(createElement(Card)));
    assert.deepEqual(frame!, searchingFrame);
  } finally {
    act(() => renderer!.unmount());
  }
});

test("a keyboard hide left over from opening the card cannot close a new search session", () => {
  let search: ReturnType<typeof usePlaylistPickerSearch>;
  function Picker() {
    const current = usePlaylistPickerSearch([{ name: "Morning" }, { name: "Evening" }]);
    useLayoutEffect(() => {
      search = current;
    });
    return null;
  }
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Picker));
  });
  try {
    act(() => search.open());
    act(() => emitKeyboard("keyboardDidHide"));
    assert.equal(search!.searching, true, "the previous screen's keyboard was already hiding");
    act(() => emitKeyboard("keyboardDidShow"));
    act(() => emitKeyboard("keyboardDidHide"));
    assert.equal(search!.searching, false, "Back hiding this session's IME closes search");

    act(() => search.open());
    act(() => emitKeyboard("keyboardDidHide"));
    assert.equal(search!.searching, true, "each session must see its own Show");
  } finally {
    act(() => renderer!.unmount());
  }
});

test("a result or veil keeps the query and results even when its keyboard hide arrives", () => {
  let entries: ReturnType<typeof overlay.useOverlayEntries> = [];
  let search: ReturnType<typeof usePlaylistPickerSearch>;
  function Picker() {
    const current = usePlaylistPickerSearch([{ name: "Morning" }, { name: "Evening" }]);
    useLayoutEffect(() => {
      search = current;
    });
    return null;
  }
  function Cards() {
    entries = overlay.useOverlayEntries();
    return entries.map((entry) =>
      createElement(
        overlay.OverlayId,
        {
          key: entry.id,
          value: entry.id,
        },
        createElement(Picker),
      ),
    );
  }
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Cards));
  });
  try {
    for (const viaVeil of [false, true]) {
      let handle: ReturnType<typeof overlay.openOverlay>;
      act(() => {
        handle = overlay.openOverlay({ label: "Picker", render: () => null });
      });
      act(() => search.open());
      act(() => emitKeyboard("keyboardDidShow"));
      act(() => search.setQuery("morn"));
      act(() => {
        if (viaVeil) overlay.dismissOverlay(entries.at(-1)!);
        else handle!.close();
      });
      act(() => emitKeyboard("keyboardDidHide"));
      assert.equal(search!.query, "morn");
      assert.deepEqual(search!.playlists, [{ name: "Morning" }]);
      assert.equal(entries.at(-1)!.search !== undefined, true);
      act(() => overlay.removeOverlay(entries.at(-1)!.id));
    }
  } finally {
    act(() => renderer!.unmount());
  }
});
