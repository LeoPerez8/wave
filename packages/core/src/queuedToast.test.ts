import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf, queuedToast, type PassOver } from "./index.ts";

const explicit: PassOver = (trackId) => trackId.startsWith("x");

describe("queuedToast", () => {
  test("one song added to the queue or played next", () => {
    assert.equal(queuedToast({ type: "addToQueue", trackIds: ["1"] }), "Added to Queue");
    assert.equal(queuedToast({ type: "playNext", trackIds: ["1"] }), "Playing Next");
  });

  test("several songs say how many went in", () => {
    assert.equal(
      queuedToast({ type: "addToQueue", trackIds: ["1", "2", "3"] }),
      "Added 3 songs to Queue",
    );
    assert.equal(
      queuedToast({ type: "playNext", trackIds: ["1", "2", "3"] }),
      "Playing 3 songs next",
    );
  });

  test("songs the queue passes over aren't counted", () => {
    assert.equal(
      queuedToast({ type: "addToQueue", trackIds: ["1", "x2", "3"] }, explicit),
      "Added 2 songs to Queue",
    );
    assert.equal(
      queuedToast({ type: "playNext", trackIds: ["x1", "2"] }, explicit),
      "Playing Next",
    );
  });

  test("nothing going in has no toast", () => {
    assert.equal(queuedToast({ type: "addToQueue", trackIds: [] }), null);
    assert.equal(queuedToast({ type: "playNext", trackIds: ["x1", "x2"] }, explicit), null);
  });

  test("other commands have no toast", () => {
    assert.equal(queuedToast({ type: "playNow", trackIds: ["1"] }), null);
    assert.equal(queuedToast({ type: "append", trackIds: ["1"] }), null);
    assert.equal(queuedToast({ type: "next" }), null);
  });
});

describe("queuedToast in Portuguese", () => {
  const pt = catalogueOf("pt-BR");

  test("one song and several", () => {
    assert.equal(
      queuedToast({ type: "addToQueue", trackIds: ["1"] }, undefined, pt),
      "Adicionada à Fila",
    );
    assert.equal(
      queuedToast({ type: "addToQueue", trackIds: ["1", "2"] }, undefined, pt),
      "2 músicas adicionadas à Fila",
    );
    assert.equal(
      queuedToast({ type: "playNext", trackIds: ["1"] }, undefined, pt),
      "Será reproduzida a seguir",
    );
    assert.equal(
      queuedToast({ type: "playNext", trackIds: ["1", "2"] }, undefined, pt),
      "2 músicas serão reproduzidas a seguir",
    );
  });
});
