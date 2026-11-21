import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogueOf,
  desktopSongActions,
  desktopSongShareMenu,
  spotifyRecordingLink,
  type SongLinksState,
} from "./index.ts";

const desktop = catalogueOf("en", "desktop");
const found: SongLinksState = {
  video: { status: "found", videoId: "abcdefghijk" },
  spotify: { status: "found", url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" },
};

test("a song's Share submenu copies its three links, then saves or copies its card", () => {
  assert.deepEqual(desktopSongShareMenu(found, desktop), [
    {
      kind: "link",
      option: "copyLink",
      label: "Copy Link",
      url: "https://song.link/y/abcdefghijk",
      note: null,
    },
    {
      kind: "link",
      option: "spotify",
      label: "Copy Spotify Link",
      url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      note: null,
    },
    {
      kind: "link",
      option: "ytMusic",
      label: "Copy YT Music Link",
      url: "https://music.youtube.com/watch?v=abcdefghijk",
      note: null,
    },
    { kind: "saveImage", label: "Save Image" },
    { kind: "copyImage", label: "Copy Image" },
  ]);
  const pt = desktopSongShareMenu(found, catalogueOf("pt-BR", "desktop")).map((item) => item.label);
  assert.deepEqual(pt, [
    "Copiar Link",
    "Copiar Link do Spotify",
    "Copiar Link do YT Music",
    "Salvar Imagem",
    "Copiar Imagem",
  ]);
});

test("a link Spotify or YT Music can't give is disabled and says why", () => {
  const items = desktopSongShareMenu(
    { video: { status: "notFound" }, spotify: { status: "signedOut" } },
    desktop,
  );
  assert.deepEqual(
    items.flatMap((item) => (item.kind === "link" ? [[item.option, item.url, item.note]] : [])),
    [
      ["copyLink", null, "No Match"],
      ["spotify", null, "Signed Out"],
      ["ytMusic", null, "No Match"],
    ],
  );
  const offline = desktopSongShareMenu(
    { video: { status: "offline" }, spotify: { status: "offline" } },
    desktop,
  );
  assert.deepEqual(
    offline.flatMap((item) => (item.kind === "link" ? [item.note] : [])),
    ["Offline", "Offline", "Offline"],
  );
});

test("with YT Music off the submenu holds the two image items only", () => {
  assert.deepEqual(
    desktopSongShareMenu(null, desktop).map((item) => item.kind),
    ["saveImage", "copyImage"],
  );
});

test("the Web API's search for the same recording becomes the song's Spotify link", () => {
  assert.deepEqual(
    spotifyRecordingLink({ ok: true, uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" }),
    {
      status: "found",
      url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    },
  );
  assert.deepEqual(spotifyRecordingLink({ ok: true, uri: null }), { status: "notFound" });
  assert.deepEqual(spotifyRecordingLink({ ok: false, reason: "offline" }), { status: "offline" });
  assert.deepEqual(spotifyRecordingLink({ ok: false, reason: "signedOut" }), {
    status: "signedOut",
  });
  assert.deepEqual(spotifyRecordingLink({ ok: false, reason: "noSearchAnswer" }), {
    status: "failed",
  });
  assert.deepEqual(spotifyRecordingLink({ ok: false, reason: "failed" }), { status: "failed" });
});

test("one song's desktop menu offers Share, a playlist's streamed entry not", () => {
  const song = { albumId: 7, artistIds: [3], favorite: false };
  const actions = (share: boolean) =>
    desktopSongActions({ items: [song], share }).map((entry) => entry.action);
  assert.equal(actions(true).includes("share"), true);
  assert.equal(actions(false).includes("share"), false);
  assert.equal(desktop.itemActions.labels.share, "Share");
  assert.equal(catalogueOf("pt-BR", "desktop").itemActions.labels.share, "Compartilhar");
});
