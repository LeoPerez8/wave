import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogueOf, homeSectionTitle, discoverRowTitle, discoverMixCaption, discoverMixPlaylist, discoverLevelLabel, recapTitle, recapWeekdayLabel, listeningHistoryDays } from "./index.ts";

test("Home headings and saved mix names follow the active catalogue without renaming a saved copy", () => {
  const pt = catalogueOf("pt-BR");
  assert.equal(homeSectionTitle("recently-played", pt), "Tocadas recentemente");
  assert.equal(discoverRowTitle("artist-mixes", pt), "Mixes de artistas");
  const mix = { id: "artist:1", seed: { kind: "artist", name: "Björk" }, songs: [] } as const;
  assert.equal(discoverMixCaption(mix, pt).title, "Mix de Björk");
  assert.equal(discoverMixCaption(mix, pt).line, "Nenhuma música");
  const saved = discoverMixPlaylist(mix, pt);
  assert.equal(saved.name, "Mix de Björk");
  assert.equal(discoverMixPlaylist(mix).name, "Björk mix");
  assert.equal(saved.name, "Mix de Björk");
  assert.equal(discoverLevelLabel(3, pt), "Equilibrado · 60% novas");
});

test("Recap and history calendar labels use Portuguese while English stays unchanged", () => {
  const pt = catalogueOf("pt-BR");
  assert.equal(recapTitle({ kind: "month", year: 2026, month: 10 }, pt), "Outubro 2026");
  assert.equal(recapTitle({ kind: "month", year: 2026, month: 10 }), "October 2026");
  assert.equal(recapWeekdayLabel(5, pt), "sextas-feiras");
  const now = new Date(2026, 9, 29, 12).getTime();
  assert.deepEqual(listeningHistoryDays([{ startedAt: now }, { startedAt: new Date(2026, 9, 28, 12).getTime() }], now, "pt-BR").map(d => d.title), ["Hoje", "Ontem"]);
});

test("Home and artist listening facts format Portuguese counts and plurals", async () => {
  const { statsFacts, artistStats, discoverMixActions, recapHourLabel } = await import("./index.ts");
  const facts = statsFacts({ songs: 1234, albums: 2, artists: 1 }, { minutesListened: 125, plays: 1234, songsListened: 1, lastPlayedAt: null }, "pt-BR");
  assert.deepEqual(facts.slice(0, 3), [{ label: "Tempo de audição", value: "2 h" }, { label: "Reproduções", value: "1.234" }, { label: "Músicas ouvidas", value: "1" }]);
  const pt = catalogueOf("pt-BR");
  for (const [count, expected] of [[0, "Nenhuma reprodução"], [1, "1 reprodução"], [2, "2 reproduções"], [1234, "1.234 reproduções"]] as const) assert.equal(pt.home.plays(count), expected);
  assert.equal(pt.home.songs(1), "1 música");
  assert.equal(pt.home.songs(1234), "1.234 músicas");
  assert.equal(recapHourLabel(22, pt), "22:00");
  assert.deepEqual(discoverMixActions({ actions: [] }, pt).map(a => a.label), ["Reproduzir a Seguir", "Adicionar à Fila", "Salvar como Playlist"]);
  const stats = artistStats({ artistId: 1, songIds: [1, 2], now: 300000, songPlays: [], listening: [{ trackId: 1, artistIds: [1], inLibrary: true, countedPlays: 1, listenedMs: 60000, lastPlayedAt: 240000 }] }, pt);
  assert.equal(stats.played, true);
  if (stats.played) {
    assert.equal(stats.plays, "1 reprodução");
    assert.equal(stats.minutesListened, "1 minuto ouvido");
    assert.equal(stats.songsListened, "1 de 2 músicas");
    assert.equal(stats.lastPlayed, "Última reprodução há 1 minuto");
  }
});
