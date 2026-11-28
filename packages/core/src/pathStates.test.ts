import assert from "node:assert/strict";
import { test } from "node:test";

import { rememberPathStates } from "./index.ts";

// The tabs navigator reads each tab's route from its path on every navigation, and the router
// builds its whole route config again for each read (#1486). The reads are remembered by path,
// config and the route groups in the segments, and each one still gets a state of its own.

type State = { routes: { name: string; params?: Record<string, string>; state?: State }[] };

const counting = () => {
  const calls: [string, object | undefined, readonly string[] | undefined][] = [];
  const read = (path: string, config?: object, segments?: readonly string[]): State | undefined => {
    calls.push([path, config, segments]);
    if (path === "/nowhere") return undefined;
    return {
      routes: [
        { name: "(tabs)", state: { routes: [{ name: path.slice(1), params: { from: "x" } }] } },
      ],
    };
  };
  return { calls, read };
};

test("a path read again with the same config and segments isn't read from the router again", () => {
  const router = counting();
  const config = {};
  const read = rememberPathStates(router.read);
  const first = read("/library", config, ["(tabs)", "index"]);
  const again = read("/library", config, ["(tabs)", "index"]);
  assert.equal(router.calls.length, 1);
  assert.deepEqual(again, first);
});

test("each read gets a state of its own, so changing one changes no other", () => {
  const router = counting();
  const config = {};
  const read = rememberPathStates(router.read);
  const first = read("/library", config)!;
  first.routes[0]!.state!.routes[0]!.params!.from = "changed";
  first.routes.push({ name: "extra" });
  const again = read("/library", config)!;
  assert.notEqual(again, first);
  assert.deepEqual(again, {
    routes: [{ name: "(tabs)", state: { routes: [{ name: "library", params: { from: "x" } }] } }],
  });
});

test("another path, other route groups in the segments or another config is read from the router", () => {
  const router = counting();
  const config = {};
  const read = rememberPathStates(router.read);
  read("/library", config, ["(tabs)", "index"]);
  read("/search", config, ["(tabs)", "index"]);
  read("/library", config, ["(other)", "index"]);
  read("/library", {}, ["(tabs)", "index"]);
  read("/library", undefined, ["(tabs)", "index"]);
  assert.equal(router.calls.length, 5);
  read("/library", undefined, ["(tabs)", "index"]);
  assert.equal(router.calls.length, 5);
});

test("segments that differ only outside route groups share one read (#1534)", () => {
  // The router weighs the segments only by the groups they hold at each position, when it sorts
  // its routes, so a tab's first visit or a push reads no tab's route again.
  const router = counting();
  const config = {};
  const read = rememberPathStates(router.read);
  const first = read("/library", config, ["(tabs)", "index"]);
  assert.deepEqual(read("/library", config, ["(tabs)", "search"]), first);
  read("/library", config, ["(tabs)", "playlists", "[id]"]);
  assert.equal(router.calls.length, 1);
  read("/library", config, ["library", "album", "[id]"]);
  read("/library", config, []);
  read("/library", config);
  assert.equal(router.calls.length, 2);
});

test("a group is told apart by its position in the segments", () => {
  const router = counting();
  const config = {};
  const read = rememberPathStates(router.read);
  read("/library", config, ["(tabs)"]);
  read("/library", config, ["library", "(tabs)"]);
  read("/library", config, ["(tabs)", "(tabs)"]);
  assert.equal(router.calls.length, 3);
});

test("a path with no route is remembered too", () => {
  const router = counting();
  const config = {};
  const read = rememberPathStates(router.read);
  assert.equal(read("/nowhere", config), undefined);
  assert.equal(read("/nowhere", config), undefined);
  assert.equal(router.calls.length, 1);
});

test("the router gets the arguments as they came", () => {
  const router = counting();
  const config = {};
  const segments = ["(tabs)", "index"];
  rememberPathStates(router.read)("/library", config, segments);
  assert.deepEqual(router.calls, [["/library", config, segments]]);
});

test("only the latest paths are kept, so a long session doesn't grow it", () => {
  const router = counting();
  const config = {};
  const read = rememberPathStates(router.read, 2);
  read("/a", config);
  read("/b", config);
  read("/a", config);
  read("/c", config);
  assert.equal(router.calls.length, 3);
  read("/a", config);
  assert.equal(router.calls.length, 3, "/a was read lately, so it stayed");
  read("/b", config);
  assert.equal(router.calls.length, 4, "/b was the oldest, so it went");
});
