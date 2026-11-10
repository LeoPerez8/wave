import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  recogniseSongLink,
  SONG_LINK_SAMPLES,
  songLinkHandling,
  songLinkHandlingLine,
  songLinkSetup,
  songLinkSetupHandling,
} from "./index.ts";

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

const SPOTIFY = { packageName: "com.spotify.music", label: "Spotify" };
const CHROME = { packageName: "com.android.chrome", label: "Chrome" };

describe("apps that still open their own song links", () => {
  test("the Spotify app opening Spotify links adds a step to turn them off in Spotify", () => {
    const setup = songLinkSetup(
      { allowed: true, hosts: hosts([]) },
      { web: CHROME, youtubeMusic: CHROME, spotify: SPOTIFY, deezer: CHROME },
    );
    assert.deepEqual(setup.turnOff, [
      {
        service: "spotify",
        packageName: "com.spotify.music",
        step: "Spotify still opens Spotify links. Turn off Open supported links there first.",
        button: "Turn Off in Spotify",
      },
    ]);
  });

  test("without any of the apps, links opening in the browser or nowhere, the setup is today's", () => {
    for (const openers of [
      null,
      {},
      { web: CHROME, youtubeMusic: CHROME, spotify: CHROME, deezer: CHROME },
      { web: null, youtubeMusic: null, spotify: null, deezer: null },
    ]) {
      assert.deepEqual(songLinkSetup({ allowed: true, hosts: hosts([SELECTED]) }, openers), {
        handling: "some",
        line: "On for some links. Tap to turn on the rest in Android's Open by default page.",
        turnOff: [],
      });
    }
  });

  test("the line names the app that still opens its links", () => {
    const setup = songLinkSetup(
      { allowed: false, hosts: hosts([]) },
      { web: CHROME, spotify: SPOTIFY },
    );
    assert.equal(
      setup.line,
      "Spotify still opens Spotify links. Off: links open in their own app or the browser. Tap to turn them on in Android's Open by default page.",
    );
  });

  test("Wave's hosts all on while an app still opens its links counts as some", () => {
    const setup = songLinkSetup(
      { allowed: true, hosts: hosts([SELECTED, SELECTED, SELECTED, SELECTED]) },
      {
        web: CHROME,
        youtubeMusic: { packageName: "com.google.android.apps.youtube.music", label: "YT Music" },
      },
    );
    assert.equal(setup.handling, "some");
    assert.equal(
      setup.line,
      "YT Music still opens YouTube Music links. On for some links. Tap to turn on the rest in Android's Open by default page.",
    );
  });

  test("once Spotify's links are off and Wave's are added, the step goes and the links open in Wave", () => {
    const setup = songLinkSetup(
      { allowed: true, hosts: hosts([SELECTED, SELECTED, SELECTED, SELECTED]) },
      { web: CHROME, youtubeMusic: null, spotify: null, deezer: null },
    );
    assert.deepEqual(setup, {
      handling: "all",
      line: "On: YouTube Music, Spotify and Deezer links open in Wave.",
      turnOff: [],
    });
  });

  test("each app holding its links gets a step, in Portuguese too", () => {
    const setup = songLinkSetup(
      { allowed: true, hosts: hosts([]) },
      {
        web: CHROME,
        youtubeMusic: { packageName: "com.google.android.apps.youtube.music", label: "YT Music" },
        deezer: { packageName: "deezer.android.app", label: "Deezer" },
      },
      "pt-BR",
    );
    assert.deepEqual(setup.turnOff, [
      {
        service: "youtubeMusic",
        packageName: "com.google.android.apps.youtube.music",
        step: "O YT Music ainda abre os links do YouTube Music. Desative Abrir links compatíveis nele primeiro.",
        button: "Desativar no YT Music",
      },
      {
        service: "deezer",
        packageName: "deezer.android.app",
        step: "O Deezer ainda abre os links do Deezer. Desative Abrir links compatíveis nele primeiro.",
        button: "Desativar no Deezer",
      },
    ]);
    assert.equal(
      setup.line,
      "O YT Music ainda abre os links do YouTube Music. O Deezer ainda abre os links do Deezer. Desativado: os links abrem no próprio app ou no navegador. Toque para ativá-los na página Abrir por padrão do Android.",
    );
  });
});

test("the setup's handling comes alone, an app holding its links making all some", () => {
  const allOn = { allowed: true, hosts: hosts([SELECTED, SELECTED, SELECTED, SELECTED]) };
  assert.equal(songLinkSetupHandling(allOn, { web: CHROME, spotify: SPOTIFY }), "some");
  assert.equal(songLinkSetupHandling(allOn, { web: CHROME, spotify: CHROME }), "all");
  assert.equal(songLinkSetupHandling(allOn, null), "all");
  assert.equal(
    songLinkSetupHandling({ allowed: true, hosts: hosts([]) }, { web: CHROME, spotify: SPOTIFY }),
    "none",
  );
});

test("each service's sample link, which Android is asked about, is a song link of that service", () => {
  assert.equal(recogniseSongLink(SONG_LINK_SAMPLES.youtubeMusic)?.service, "ytMusic");
  assert.equal(recogniseSongLink(SONG_LINK_SAMPLES.spotify)?.service, "spotify");
  assert.equal(recogniseSongLink(SONG_LINK_SAMPLES.deezer)?.service, "deezer");
  assert.equal(recogniseSongLink(SONG_LINK_SAMPLES.web), null);
});
