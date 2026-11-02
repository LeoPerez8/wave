import { releaseCandidates, releaseAnswer } from "../../packages/core/src/releaseLookup.ts";
import { releaseLookupClient } from "../../apps/mobile/src/library/releaseLookupClient.ts";
import { writeFileSync } from "node:fs";
const songs = [
  ["Wonderwall", "Oasis"],
  ["Hey Jude", "The Beatles"],
  ["Billie Jean", "Michael Jackson"],
  ["Like a Prayer", "Madonna"],
  ["Smells Like Teen Spirit", "Nirvana"],
  ["Bohemian Rhapsody", "Queen"],
  ["Rolling in the Deep", "Adele"],
  ["Bad Romance", "Lady Gaga"],
  ["Blinding Lights", "The Weeknd"],
  ["Shake It Off", "Taylor Swift"],
  ["Halo", "Beyoncé"],
  ["Yellow", "Coldplay"],
  ["Creep", "Radiohead"],
  ["Take On Me", "a-ha"],
  ["Dancing Queen", "ABBA"],
  ["Hotel California", "Eagles"],
  ["Dreams", "Fleetwood Mac"],
  ["Toxic", "Britney Spears"],
  ["Lose Yourself", "Eminem"],
  ["Hips Don’t Lie", "Shakira"],
  ["Águas de Março", "Elis Regina"],
  ["Construção", "Chico Buarque"],
  ["Garota de Ipanema", "Tom Jobim"],
  ["Oceano", "Djavan"],
  ["Sozinho", "Caetano Veloso"],
  ["Pais e Filhos", "Legião Urbana"],
  ["Tempo Perdido", "Legião Urbana"],
  ["Evidências", "Chitãozinho & Xororó"],
  ["Como Nossos Pais", "Belchior"],
  ["Anunciação", "Alceu Valença"],
  ["Asa Branca", "Luiz Gonzaga"],
  ["O Que É, O Que É?", "Gonzaguinha"],
  ["Mas Que Nada", "Jorge Ben Jor"],
  ["Descobridor dos Sete Mares", "Tim Maia"],
  ["Trem das Onze", "Adoniran Barbosa"],
  ["Cheia de Manias", "Raça Negra"],
  ["Meu Abrigo", "Melim"],
  ["Envolver", "Anitta"],
  ["Leão", "Marília Mendonça"],
  ["Aquarela", "Toquinho"],
];
const client = releaseLookupClient(
  (url, headers) => fetch(url, { headers, signal: AbortSignal.timeout(20000) }),
  (ms) => new Promise((r) => setTimeout(r, Math.max(1000, ms))),
);
const rows = [];
for (const [title, artist] of songs) {
  try {
    const response = await client.search(title!, artist!);
    rows.push({
      title: title!,
      artist: artist!,
      brazilian: rows.length >= 20,
      response,
      candidates: releaseCandidates({ title: title!, artist: artist! }, response),
    });
  } catch (error) {
    rows.push({
      title: title!,
      artist: artist!,
      brazilian: rows.length >= 20,
      error: String(error),
      candidates: [],
    });
  }
}
let recordings: unknown[] = [];
let mbError: string | undefined;
try {
  recordings = await client.recordings(rows.flatMap((r) => r.candidates.map((c) => c.isrc)));
} catch (error) {
  mbError = String(error);
}
const results = rows.map((r) => ({
  ...r,
  answer: releaseAnswer(
    r.candidates.map((c) => c.isrc),
    recordings,
    null,
    null,
    Date.now(),
  ),
}));
const compact = results.map((r) => ({
  ...r,
  response:
    "response" in r
      ? {
          data: ((r.response as { data?: Record<string, unknown>[] }).data ?? []).map((v) => ({
            title: v.title,
            artist: { name: (v.artist as { name: string }).name },
            isrc: v.isrc,
            album: { id: (v.album as { id: number }).id },
          })),
        }
      : undefined,
}));
const recorded = recordings.map((b) => {
  const body = b as { count: number; recordings: Record<string, unknown>[] };
  return {
    count: body.count,
    recordings: body.recordings.map((r) => ({
      isrcs: r.isrcs,
      "first-release-date": r["first-release-date"],
    })),
  };
});
writeFileSync(
  "scripts/release-lookup/sample-recorded.json",
  JSON.stringify(
    { at: new Date().toISOString(), mbError, recordings: recorded, results: compact },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    total: results.length,
    candidates: results.filter((r) => r.candidates.length).length,
    dates: results.filter((r) => r.answer.date).length,
    brazilian: results.filter((r) => r.brazilian).length,
    brCandidates: results.filter((r) => r.brazilian && r.candidates.length).length,
    brDates: results.filter((r) => r.brazilian && r.answer.date).length,
    mbError,
  }),
);
