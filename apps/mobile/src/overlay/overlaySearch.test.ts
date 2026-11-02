import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const native = "data:text/javascript,export const AppState = {};";
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
hooks.deregister();

test("Back closes the top card's search before dismissing the card; choosing closes search at once", () => {
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

    act(() => {
      handle = overlay.openOverlay({ label: "Picker", render: () => null });
    });
    const nextId = entries.at(-1)!.id;
    act(() =>
      overlay.setOverlaySearch(nextId, {
        close: () => {
          closedSearch++;
        },
      }),
    );
    act(() => handle!.close());
    assert.equal(closedSearch, 2, "choosing closes the search before a follow-up prompt can focus");
    act(() => overlay.removeOverlay(nextId));
  } finally {
    act(() => {
      overlay.dismissAllOverlays();
      for (const entry of entries) overlay.removeOverlay(entry.id);
      renderer!.unmount();
    });
  }
});
