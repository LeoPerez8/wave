import assert from "node:assert/strict";
import { test } from "node:test";
import { autoChildren, autoItem, autoPageItems, autoPlaylistItem, catalogueOf } from "./index.ts";

test("Auto translates the tree, shuffle and empty rows without translating names or IDs", () => {
  const pt = catalogueOf("pt-BR");
  const root = { type: "root" } as const;
  assert.deepEqual(
    autoChildren(root, 0, 10, pt)?.items.map((x) => x.title),
    ["Início", "Playlists", "Álbuns", "Artistas"],
  );
  assert.deepEqual(
    autoChildren({ type: "tab", tab: "home" }, 0, 10, pt)?.items.map((x) => x.title),
    ["Tocadas Recentemente", "Mais Tocadas", "Favoritas"],
  );
  assert.equal(
    autoItem({ type: "shuffle", list: { kind: "artistSongs", id: "1" } }, pt)?.title,
    "Embaralhar Tudo",
  );
  const empty = autoPageItems({ type: "tab", tab: "playlists" }, 0, [], pt)[0];
  assert.equal(empty?.title, "Nenhuma playlist ainda");
  assert.equal(empty?.subtitle, "Crie uma no Wave pelo celular");
  for (const [count, text] of [
    [0, "Nenhuma música"],
    [1, "1 música"],
    [2, "2 músicas"],
    [1234, "1.234 músicas"],
  ] as const) {
    const row = autoPlaylistItem({ id: 1, name: "My songs", trackCount: count }, pt);
    assert.equal(row.title, "My songs");
    assert.equal(row.subtitle, text);
    assert.equal(row.mediaId, "playlist/1");
  }
});

test("download notification translates counts and time estimates", async () => {
  const { downloadRunNotice } = await import("./downloadRun.ts");
  assert.deepEqual(
    downloadRunNotice({ done: 1234, failed: 12, left: 1254, total: 2500 }, 118 * 60_000, "pt-BR"),
    {
      title: "Baixando 1.234 de 2.500",
      text: "12 falharam · 1.254 restantes · Cerca de 2 h restantes",
      finished: 1246,
      total: 2500,
    },
  );
});

test("Portuguese Auto empty states cover each Home shelf", () => {
  const pt = catalogueOf("pt-BR");
  const emptyCases = [
    [
      { type: "recentlyPlayed" },
      "Nada foi reproduzido ainda",
      "Os álbuns que você reproduzir aparecem aqui",
    ],
    [
      { type: "list", list: { kind: "home", id: "most-played" } },
      "Nenhuma reprodução ainda",
      "As músicas mais tocadas aparecem aqui",
    ],
    [
      { type: "list", list: { kind: "home", id: "favorites" } },
      "Nenhuma favorita ainda",
      "As músicas que você favoritar aparecem aqui",
    ],
  ] as const;
  for (const [node, title, subtitle] of emptyCases) {
    const row = autoPageItems(node, 0, [], pt)[0];
    assert.equal(row?.title, title);
    assert.equal(row?.subtitle, subtitle);
    assert.deepEqual(autoItem({ type: "empty", parent: node }, pt), row);
  }
});

test("Portuguese download failures and remaining songs use singular and plural", async () => {
  const { downloadRunNotice } = await import("./downloadRun.ts");
  assert.equal(
    downloadRunNotice({ done: 0, failed: 1, left: 1, total: 2 }, null, "pt-BR")?.text,
    "1 falhou · 1 restante",
  );
  assert.equal(
    downloadRunNotice({ done: 2, failed: 0, left: 0, total: 2 }, null, "pt-BR")?.text,
    "0 restantes",
  );
});
