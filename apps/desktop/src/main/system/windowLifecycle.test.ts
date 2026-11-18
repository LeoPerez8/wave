import assert from "node:assert/strict";
import { test } from "node:test";
import { createWindowLifecycle } from "./windowLifecycle.ts";

test("closing hides without quitting, explains it once across launches, and can be reopened", async () => {
  let visible = true;
  let noticed = false;
  let notices = 0;
  let quits = 0;
  const port = {
    visible: () => visible,
    hide: () => {
      visible = false;
    },
    show: () => {
      visible = true;
    },
    quit: () => {
      quits++;
    },
    closeQuits: () => false,
    noticed: () => noticed,
    rememberNotice: () => {
      noticed = true;
    },
    notice: async () => {
      notices++;
    },
  };
  const lifecycle = createWindowLifecycle(port);
  let prevented = 0;
  lifecycle.close({
    preventDefault: () => {
      prevented++;
    },
  });
  assert.equal(visible, false);
  assert.equal(quits, 0);
  assert.equal(prevented, 1);
  assert.equal(notices, 1);
  lifecycle.show();
  assert.equal(visible, true);
  createWindowLifecycle(port).close({ preventDefault: () => {} });
  assert.equal(notices, 1);
  lifecycle.toggle();
  assert.equal(visible, true);
  lifecycle.toggle();
  assert.equal(visible, false);
});

test("the quit setting exits, and an explicit quit lets the window close", () => {
  let quits = 0;
  const lifecycle = createWindowLifecycle({
    visible: () => true,
    hide: () => assert.fail("must quit"),
    show: () => {},
    quit: () => {
      quits++;
    },
    closeQuits: () => true,
    noticed: () => false,
    rememberNotice: () => assert.fail("no tray notice on quit"),
    notice: async () => assert.fail("no tray notice on quit"),
  });
  lifecycle.close({ preventDefault: () => {} });
  assert.equal(quits, 1);
  lifecycle.beginQuit();
  lifecycle.close({ preventDefault: () => assert.fail("explicit quit must close") });
});
