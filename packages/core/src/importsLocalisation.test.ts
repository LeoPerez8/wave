import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  confirmImportReplace,
  importBatchLine,
  importProgressLine,
  linkImportView,
  NO_YT_LIBRARY_READS,
  planLinkImport,
  playlistLinkReason,
  queueYtLibraryReads,
  sharedTextImport,
  spotifyLibraryFailure,
  spotifyLibraryPicker,
  summarizeM3uImport,
  ytLibraryFailure,
  ytLibraryPicker,
  ytLibraryReadFailed,
  ytLibraryReadView,
  type YtAlbumSong,
} from "./index.ts";

const PT = "pt-BR";

const yt = (videoId: string, title: string): YtAlbumSong => ({
  videoId,
  title,
  artists: ["Justice"],
  album: "Cross",
  albumId: "MPREb_cross",
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

const read = (songs: readonly YtAlbumSong[], truncated = false) => {
  const playlist = { title: "Drive", artworkUrl: null, songs, repeats: [], truncated };
  return {
    status: "read",
    playlist,
    plan: planLinkImport({ service: "ytMusic", playlist }, [
      { id: 11, title: "Genesis", artist: "Justice", durationMs: 234_000 },
    ]),
  } as const;
};

describe("importing from a link, in Portuguese", () => {
  test("the card counts the songs and how many the Library has", () => {
    const view = linkImportView(read([yt("g1", "Genesis"), yt("s1", "Stress")]), PT);
    assert.equal(view.line, "2 músicas · 1 na sua Biblioteca");
    assert.equal(
      linkImportView(read([yt("s1", "Stress")]), PT).line,
      "1 música · nenhuma na sua Biblioteca",
    );
    assert.equal(
      linkImportView(read([yt("g1", "Genesis")]), PT).line,
      "1 música · todas na sua Biblioteca",
    );
    assert.equal(
      linkImportView(read([yt("s1", "Stress")], true), PT).note,
      "Ela passa de 1 música. Só essas são importadas.",
    );
  });

  test("reading, failing and an empty playlist read in Portuguese", () => {
    assert.equal(linkImportView({ status: "reading" }, PT).line, "Lendo a playlist…");
    assert.equal(
      linkImportView({ status: "failed", reason: "missing" }, PT).line,
      "Esta playlist não existe ou não é pública.",
    );
    assert.equal(linkImportView(read([]), PT).line, "Ela não tem músicas para importar.");
  });

  test("a link that isn't a playlist says why", () => {
    assert.equal(
      playlistLinkReason("song", PT),
      "Este é o link de uma música, não de uma playlist.",
    );
    assert.equal(
      playlistLinkReason("empty"),
      "Paste a link to a YouTube Music or Spotify playlist.",
    );
    assert.deepEqual(sharedTextImport("hello", { ytMusic: false }, PT), {
      kind: "notice",
      title: "O YT Music está desativado",
      message:
        "Ative o YT Music em Ajustes para importar playlists de links do YouTube Music e do Spotify.",
    });
    assert.deepEqual(sharedTextImport("hello", { ytMusic: true }, PT), {
      kind: "notice",
      title: "Não é possível importar isto",
      message: "O Wave importa playlists de links do YouTube Music e do Spotify.",
    });
  });
});

describe("import progress in Portuguese", () => {
  test("each phase's line", () => {
    assert.equal(importProgressLine({ phase: "waiting", total: null }, PT), "Aguardando");
    assert.equal(
      importProgressLine({ phase: "waiting", total: 1234 }, PT),
      "Aguardando · 1.234 músicas",
    );
    assert.equal(
      importProgressLine({ phase: "reading", done: 2300, total: 10_000 }, PT),
      "Lendo 2.300 de 10.000",
    );
    assert.equal(
      importProgressLine({ phase: "reading", done: 2300, total: null }, PT),
      "Lendo 2.300",
    );
    assert.equal(importProgressLine({ phase: "matching" }, PT), "Comparando com a Biblioteca…");
    assert.equal(
      importProgressLine({ phase: "adding", done: 340, total: 10_000 }, PT),
      "Adicionando 340 de 10.000",
    );
  });

  test("the batch line at the top of Playlists", () => {
    const toQueue = (playlistId: number) => ({
      source: `PL${playlistId}`,
      playlistId,
      name: `Playlist ${playlistId}`,
      capped: true,
      favorites: false,
      download: false,
      expected: 100,
    });
    const batch = queueYtLibraryReads(NO_YT_LIBRARY_READS, [toQueue(1), toQueue(2)]);
    assert.equal(importBatchLine(batch, [], null, PT)?.text, "Importando playlists · 0 de 2");
    assert.equal(importBatchLine(batch, [], "offline", PT)?.text, "Importação pausada · offline");
    assert.equal(
      importBatchLine(batch, [], "signedOut", PT)?.text,
      "Importação pausada · sessão do Spotify finalizada",
    );
    const [first] = batch.reads;
    if (first === undefined) throw new Error("no read");
    const failed = ytLibraryReadFailed(batch, first, "refused").batch;
    const failedRead = failed.reads.find((r) => r.playlistId === 1);
    assert.equal(ytLibraryReadView(failed, 1, PT)?.line, "Não foi possível lê-la online");
    assert.ok(failedRead);
  });
});

describe("From YT Music and From Spotify in Portuguese", () => {
  test("Liked Songs is named in the active language, with its count", () => {
    const picker = ytLibraryPicker(
      [{ kind: "own", playlistId: "LM", title: "Liked Music", artworkUrl: null, songCount: 0 }],
      undefined,
      PT,
    );
    assert.equal(picker.rows[0]?.title, "Músicas Curtidas");
    assert.equal(picker.rows[0]?.line, "Nenhuma música");
    const spotify = spotifyLibraryPicker([], undefined, PT);
    assert.equal(spotify.rows[0]?.title, "Músicas Curtidas");
  });

  test("a library that wasn't read says why", () => {
    assert.equal(
      ytLibraryFailure("offline", PT).line,
      "Você está offline. Tente novamente quando estiver online.",
    );
    assert.equal(
      ytLibraryFailure("signedOut", PT).line,
      "Sua sessão do YouTube terminou. Inicie a sessão novamente para ver suas playlists.",
    );
    assert.equal(
      spotifyLibraryFailure("changed", PT).line,
      "O Spotify mudou algo. Tente novamente depois de atualizar o Wave.",
    );
  });
});

describe("playlists from files in Portuguese", () => {
  test("a name clash asks Replace or Keep Both", () => {
    assert.deepEqual(confirmImportReplace("Road Trip", PT), {
      title: "Substituir Road Trip?",
      message:
        "Você já tem uma playlist chamada Road Trip. Substitua as músicas dela pelas importadas ou mantenha as duas playlists.",
      action: { label: "Substituir", destructive: true },
      dismissLabel: "Manter as Duas",
    });
  });

  test("the summary names or counts what was imported", () => {
    assert.deepEqual(
      summarizeM3uImport(
        [
          {
            kind: "imported",
            name: "Road Trip",
            songs: 1,
            missing: ["a.mp3", "b.mp3"],
            replaced: true,
          },
          { kind: "nothingFound", file: "x.m3u", missing: [] },
          { kind: "notPlaylist", file: "y.txt" },
          { kind: "unreadable", file: "z.m3u" },
        ],
        PT,
      ),
      {
        title: "Road Trip importada",
        sections: [
          {
            heading: "Road Trip",
            detail: "Substituída · 1 música · 2 fora da sua biblioteca",
            missing: ["a.mp3", "b.mp3"],
          },
          { heading: "x.m3u", detail: "Ela não lista nenhuma música", missing: [] },
          { heading: "y.txt", detail: "Não é uma playlist M3U", missing: [] },
          { heading: "z.m3u", detail: "Não foi possível ler", missing: [] },
        ],
      },
    );
    assert.equal(summarizeM3uImport([], PT).title, "Nada importado");
    const two = { kind: "imported", songs: 2, missing: [], replaced: false } as const;
    assert.equal(
      summarizeM3uImport(
        [
          { ...two, name: "A" },
          { ...two, name: "B" },
        ],
        PT,
      ).title,
      "2 playlists importadas",
    );
  });
});
