import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { songLinkHandling, songLinkHandlingLine } from "./index.ts";

// Android's DomainVerificationUserState host states.
const NONE = 0;
const SELECTED = 1;
const VERIFIED = 2;

const hosts = (states: readonly number[]) =>
  Object.fromEntries(
    ["music.youtube.com", "open.spotify.com", "spotify.link", "deezer.com"].map((host, i) => [
      host,
      states[i] ?? NONE,
    ]),
  );

describe("whether Android lets Wave open song links", () => {
  test("every one of Wave's hosts turned on in Open by default is all", () => {
    assert.equal(
      songLinkHandling({ allowed: true, hosts: hosts([SELECTED, SELECTED, SELECTED, SELECTED]) }),
      "all",
    );
  });

  test("a host Android verified for Wave counts as on", () => {
    assert.equal(
      songLinkHandling({ allowed: true, hosts: hosts([VERIFIED, SELECTED, SELECTED, SELECTED]) }),
      "all",
    );
  });

  test("some hosts on and others off is some", () => {
    assert.equal(
      songLinkHandling({ allowed: true, hosts: hosts([SELECTED, NONE, SELECTED, NONE]) }),
      "some",
    );
  });

  test("no host on is none", () => {
    assert.equal(songLinkHandling({ allowed: true, hosts: hosts([]) }), "none");
  });

  test("with Open supported links switched off, the hosts turned on don't open anything", () => {
    assert.equal(
      songLinkHandling({ allowed: false, hosts: hosts([SELECTED, SELECTED, SELECTED, SELECTED]) }),
      "none",
    );
  });

  test("Android listing no host for Wave is none", () => {
    assert.equal(songLinkHandling({ allowed: true, hosts: {} }), "none");
  });
});

describe("the Open song links in Wave row's line", () => {
  test("says which links open in Wave, in English and Portuguese", () => {
    assert.equal(
      songLinkHandlingLine("all"),
      "On: YouTube Music, Spotify and Deezer links open in Wave.",
    );
    assert.equal(
      songLinkHandlingLine("some"),
      "On for some links. Tap to turn on the rest in Android's Open by default page.",
    );
    assert.equal(
      songLinkHandlingLine("none"),
      "Off: links open in their own app or the browser. Tap to turn them on in Android's Open by default page.",
    );
    assert.equal(
      songLinkHandlingLine("all", "pt-BR"),
      "Ativado: links do YouTube Music, Spotify e Deezer abrem no Wave.",
    );
    assert.equal(
      songLinkHandlingLine("some", "pt-BR"),
      "Ativado para alguns links. Toque para ativar os outros na página Abrir por padrão do Android.",
    );
    assert.equal(
      songLinkHandlingLine("none", "pt-BR"),
      "Desativado: os links abrem no próprio app ou no navegador. Toque para ativá-los na página Abrir por padrão do Android.",
    );
  });
});
