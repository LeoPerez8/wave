import assert from "node:assert/strict";
import { test } from "node:test";
import {
  geniusLyricsSearchRequest,
  isLyricPhraseQuery,
  queryNamesSong,
  songNamedByQuery,
} from "./index.ts";

const tryMyLuck = { title: "Try My Luck", artists: ["WayV"] };

test("a song's title plus its artist names the song, in either order", () => {
  assert.equal(queryNamesSong("try my luck wayV", tryMyLuck), true);
  assert.equal(queryNamesSong("wayV try my luck", tryMyLuck), true);
  assert.equal(queryNamesSong("  TRY my LUCK   WayV ", tryMyLuck), true);
});

test("the title or the artist alone doesn't name the song", () => {
  assert.equal(queryNamesSong("try my luck", tryMyLuck), false);
  assert.equal(queryNamesSong("wayv", tryMyLuck), false);
  assert.equal(queryNamesSong("", tryMyLuck), false);
});

test("the title has to be the song's whole title, kept together", () => {
  assert.equal(queryNamesSong("try my wayv", tryMyLuck), false);
  assert.equal(queryNamesSong("try wayv my luck", tryMyLuck), false);
  assert.equal(queryNamesSong("try my luck again wayv", tryMyLuck), false);
});

test("the artist's words are whole words of an artist", () => {
  assert.equal(queryNamesSong("try my luck way", tryMyLuck), false);
  assert.equal(queryNamesSong("try my luck nct", tryMyLuck), false);
  const kun = { title: "Kick Back", artists: ["Kenshi Yonezu"] };
  assert.equal(queryNamesSong("kick back yonezu", kun), true);
  assert.equal(queryNamesSong("kenshi yonezu kick back", kun), true);
  assert.equal(queryNamesSong("kick back kenshi yonezu", kun), true);
  assert.equal(queryNamesSong("kick back yon", kun), false);
});

test("any of the song's artists counts, and an artist split by punctuation may be written as one word", () => {
  const song = { title: "Highway to Hell", artists: ["AC/DC", "Someone Else"] };
  assert.equal(queryNamesSong("highway to hell acdc", song), true);
  assert.equal(queryNamesSong("highway to hell ac dc", song), true);
  assert.equal(queryNamesSong("highway to hell else", song), true);
  const library = { title: "Moonlight", artists: ["Ariana Grande feat. Someone"] };
  assert.equal(queryNamesSong("moonlight grande", library), true);
});

test("case, accents and punctuation are ignored, as Search ignores them", () => {
  const song = { title: "Don't Stop Me Now", artists: ["Beyoncé"] };
  assert.equal(queryNamesSong("dont stop me now beyonce", song), true);
  assert.equal(queryNamesSong("BEYONCÉ don't stop me now!", song), true);
});

test("a title's featuring or version note and a leading article may be left out", () => {
  assert.equal(
    queryNamesSong("try my luck wayv", { title: "Try My Luck (feat. Someone)", artists: ["WayV"] }),
    true,
  );
  assert.equal(
    queryNamesSong("try my luck wayv", { title: "Try My Luck - Remastered", artists: ["WayV"] }),
    true,
  );
  assert.equal(
    queryNamesSong("scientist coldplay", { title: "The Scientist", artists: ["Coldplay"] }),
    true,
  );
});

test("songNamedByQuery picks the first song the query names", () => {
  const songs = [
    { id: 1, title: "Luck", artist: "WayV" },
    { id: 2, title: "Try My Luck", artist: "Other" },
    { id: 3, title: "Try My Luck", artist: "WayV" },
    { id: 4, title: "Try My Luck", artist: "WayV" },
  ];
  const describe = (song: (typeof songs)[number]) => ({
    title: song.title,
    artists: [song.artist],
  });
  assert.equal(songNamedByQuery("try my luck wayv", songs, describe)?.id, 3);
  assert.equal(songNamedByQuery("under a pink moon", songs, describe), null);
});

test("three or more words are a lyric phrase unless the query names a song", () => {
  assert.equal(isLyricPhraseQuery("under a pink moon", false), true);
  assert.equal(isLyricPhraseQuery("pink moon", false), false);
  assert.equal(isLyricPhraseQuery("try my luck wayv", true), false);
});

test("Genius isn't asked for a query that names a song", () => {
  assert.notEqual(geniusLyricsSearchRequest("try my luck wayv", true), null);
  assert.equal(geniusLyricsSearchRequest("try my luck wayv", true, true), null);
  assert.equal(
    geniusLyricsSearchRequest("under a pink moon", true, false)?.query,
    "under a pink moon",
  );
});
