import assert from "node:assert/strict";
import { test } from "node:test";

import {
  geniusAbout,
  geniusReferents,
  geniusTranslationRequests,
  geniusTranslationTarget,
  placeGeniusReferents,
  savedGenius,
  storedGenius,
  withGeniusTranslation,
  type GeniusReferent,
  type SavedGenius,
} from "./index.ts";

const song = { title: "Imagine", artist: "John Lennon" };
const answer: SavedGenius = {
  checkedAt: 100,
  match: null,
  description: "A song about peace.\n\nIts second paragraph.",
  referents: null,
  translations: {},
};
const PORTUGUESE = "Uma canção sobre paz.\n\nSeu segundo parágrafo.";

test("only an app in pt-BR translates Genius's text", () => {
  assert.equal(geniusTranslationTarget("pt-BR"), "pt");
  assert.equal(geniusTranslationTarget("en"), null);
});

test("the About is sent whole to Google, paragraphs and all", () => {
  const [request, ...rest] = geniusTranslationRequests(answer, "pt");
  assert.equal(rest.length, 0);
  assert.equal(
    request?.url,
    "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=pt",
  );
  assert.equal(request?.body, "q=A%20song%20about%20peace.%0A%0AIts%20second%20paragraph.");
});

test("an answer without a description asks nothing", () => {
  assert.deepEqual(geniusTranslationRequests({ ...answer, description: null }, "pt"), []);
});

test("the original shows until Google's reply is read, then the translation", () => {
  assert.equal(geniusAbout(answer, "pt"), answer.description);
  const translated = withGeniusTranslation(answer, "pt", [[[PORTUGUESE, "en"]]]);
  assert.ok(translated !== null);
  assert.equal(geniusAbout(translated, "pt"), PORTUGUESE);
  assert.equal(translated.description, answer.description);
  assert.deepEqual(geniusTranslationRequests(translated, "pt"), []);
});

test("an app in English shows the original of a translated answer", () => {
  const translated = withGeniusTranslation(answer, "pt", [[[PORTUGUESE, "en"]]]);
  assert.equal(geniusAbout(translated!, null), answer.description);
});

test("text already in Portuguese shows as it came and isn't asked again", () => {
  const already = { ...answer, description: "Uma canção sobre paz." };
  const read = withGeniusTranslation(already, "pt", [[["Uma cancao sobre a paz.", "pt-BR"]]]);
  assert.ok(read !== null);
  assert.equal(geniusAbout(read, "pt"), "Uma canção sobre paz.");
  assert.deepEqual(geniusTranslationRequests(read, "pt"), []);
});

test("a reply that doesn't answer the request is a failure", () => {
  for (const reply of [
    null,
    {},
    [],
    [
      [PORTUGUESE, "en"],
      ["more", "en"],
    ],
    [[1, "en"]],
    [["  ", "en"]],
  ])
    assert.equal(withGeniusTranslation(answer, "pt", [reply]), null);
});

test("the translation comes back from the saved answer", () => {
  const translated = withGeniusTranslation(answer, "pt", [[[PORTUGUESE, "en"]]])!;
  const read = savedGenius(storedGenius(song, translated), 200, song);
  assert.deepEqual(read, translated);
});

test("an answer saved before this feature reads with no translation and is asked", () => {
  const old = JSON.stringify({
    version: 1,
    asked: song,
    checkedAt: 100,
    match: null,
    description: "About",
    referents: null,
  });
  const read = savedGenius(old, 200, song);
  assert.equal(read?.description, "About");
  assert.deepEqual(read?.translations, {});
  assert.equal(geniusTranslationRequests(read!, "pt")[0]?.body, "q=About");
});

test("unreadable saved translations cost the translations, not the answer", () => {
  const stored = JSON.parse(storedGenius(song, answer));
  for (const translations of ["bad", 1, { key: 2 }, ["x"]]) {
    const read = savedGenius(JSON.stringify({ ...stored, translations }), 200, song);
    assert.equal(read?.description, answer.description);
    assert.deepEqual(read?.translations, {});
  }
});

test("a description that changed isn't shown the old translation and is asked anew", () => {
  const translated = withGeniusTranslation(answer, "pt", [[[PORTUGUESE, "en"]]])!;
  const changed = { ...translated, description: "A new description." };
  assert.equal(geniusAbout(changed, "pt"), "A new description.");
  assert.equal(geniusTranslationRequests(changed, "pt")[0]?.body, "q=A%20new%20description.");
  const again = withGeniusTranslation(changed, "pt", [[["Uma nova descrição.", "en"]]])!;
  assert.equal(geniusAbout(again, "pt"), "Uma nova descrição.");
  assert.equal(Object.keys(again.translations).length, 1);
});

const referent = (id: number, fragment: string, ...texts: string[]): GeniusReferent => ({
  id,
  fragment,
  annotations: texts.map((text) => ({ text, authors: ["Ana"], state: "pending" })),
});
const annotated: SavedGenius = {
  ...answer,
  description: "About.",
  referents: [
    referent(1, "Imagine there's no heaven", "Heaven.", "Hell."),
    referent(2, "No hell", "Sky."),
  ],
};
const sentTexts = (body: string): string[] =>
  body.split("&").map((field) => decodeURIComponent(field.slice(2)));
/** Google's reply to [body], each text "pt <text>". */
const replyTo = (body: string): unknown => sentTexts(body).map((text) => [`pt ${text}`, "en"]);
const translate = (saved: SavedGenius): SavedGenius => {
  const replies = geniusTranslationRequests(saved, "pt").map(({ body }) => replyTo(body));
  return withGeniusTranslation(saved, "pt", replies)!;
};

test("the About and every annotation's text are asked for together", () => {
  const requests = geniusTranslationRequests(annotated, "pt");
  assert.equal(requests.length, 1);
  assert.deepEqual(sentTexts(requests[0]!.body), ["About.", "Heaven.", "Hell.", "Sky."]);
});

test("each annotation shows its own translation; fragment, author and state stay", () => {
  const translated = translate(annotated);
  assert.deepEqual(geniusReferents(translated, "pt"), [
    referent(1, "Imagine there's no heaven", "pt Heaven.", "pt Hell."),
    referent(2, "No hell", "pt Sky."),
  ]);
  assert.equal(geniusAbout(translated, "pt"), "pt About.");
  assert.deepEqual(translated.referents, annotated.referents);
});

test("the original annotations show before the translation and in English", () => {
  assert.deepEqual(geniusReferents(annotated, "pt"), annotated.referents);
  assert.deepEqual(geniusReferents(translate(annotated), null), annotated.referents);
  assert.equal(geniusReferents({ ...annotated, referents: null }, "pt"), null);
});

test("a translated answer's highlights land where the original's do", () => {
  const lines = ["Imagine there's no heaven", "No hell below us"];
  const place = (referents: readonly GeniusReferent[]) =>
    placeGeniusReferents(lines, referents).lines.map((line) =>
      line.map(({ start, end, referents: on }) => [start, end, on.map(({ id }) => id)]),
    );
  const translated = geniusReferents(translate(annotated), "pt")!;
  assert.deepEqual(place(translated), place(annotated.referents!));
});

test("the same text on two annotations is asked once and shows on both", () => {
  const twice = {
    ...annotated,
    referents: [referent(1, "a", "Same."), referent(2, "b", "Same.")],
  };
  assert.deepEqual(sentTexts(geniusTranslationRequests(twice, "pt")[0]!.body), ["About.", "Same."]);
  const shown = geniusReferents(translate(twice), "pt")!;
  assert.deepEqual(
    shown.map(({ annotations }) => annotations[0]!.text),
    ["pt Same.", "pt Same."],
  );
});

test("a song with hundreds of annotations is split, each text on its own annotation", () => {
  const referents = Array.from({ length: 900 }, (_, at) =>
    referent(at, `line ${at}`, `Annotation ${at}: ${"é a long explanation ".repeat(40)}end.`),
  );
  const many = { ...annotated, referents };
  const requests = geniusTranslationRequests(many, "pt");
  assert.ok(requests.length > 1);
  for (const { body } of requests) assert.ok(body.length <= 60_000, `${body.length} bytes`);
  const sent = requests.flatMap(({ body }) => sentTexts(body));
  assert.equal(sent.length, 901);
  const shown = geniusReferents(translate(many), "pt")!;
  shown.forEach(({ annotations }, at) =>
    assert.equal(annotations[0]!.text, `pt ${referents[at]!.annotations[0]!.text}`),
  );
  assert.deepEqual(geniusTranslationRequests(translate(many), "pt"), []);
});

test("a text over the limit goes alone rather than being left out", () => {
  const long = `${"word ".repeat(30_000)}end`;
  const big = { ...annotated, referents: [referent(1, "a", "Short."), referent(2, "b", long)] };
  const bodies = geniusTranslationRequests(big, "pt").map(({ body }) => sentTexts(body));
  assert.deepEqual(bodies, [["About.", "Short."], [long]]);
});

test("one split request failing saves nothing at all", () => {
  const many = {
    ...annotated,
    referents: Array.from({ length: 900 }, (_, at) =>
      referent(at, "x", `${at} ${"long text ".repeat(100)}end.`),
    ),
  };
  const replies = geniusTranslationRequests(many, "pt").map(({ body }) => replyTo(body));
  assert.ok(replies.length > 1);
  for (const broken of [
    replies.slice(0, -1),
    [...replies, []],
    [...replies.slice(0, -1), []],
    [
      ...replies.slice(0, -1),
      sentTexts(geniusTranslationRequests(many, "pt").at(-1)!.body).map(() => [""]),
    ],
  ])
    assert.equal(withGeniusTranslation(many, "pt", broken), null);
});

test("annotations missing a translation all show as they came, never a mix", () => {
  const translated = translate(annotated);
  const edited = {
    ...translated,
    referents: [...annotated.referents!, referent(3, "new", "New annotation.")],
  };
  assert.deepEqual(geniusReferents(edited, "pt"), edited.referents);
  assert.deepEqual(sentTexts(geniusTranslationRequests(edited, "pt")[0]!.body), [
    "New annotation.",
  ]);
  assert.equal(geniusAbout(edited, "pt"), "pt About.");
});

test("annotations that arrive after the About's translation are asked alone", () => {
  const about = translate({ ...annotated, referents: null });
  const later = { ...about, referents: annotated.referents };
  assert.deepEqual(sentTexts(geniusTranslationRequests(later, "pt")[0]!.body), [
    "Heaven.",
    "Hell.",
    "Sky.",
  ]);
  assert.equal(geniusAbout(translate(later), "pt"), "pt About.");
});

test("translated annotations come back from the saved answer", () => {
  const translated = translate(annotated);
  const read = savedGenius(storedGenius(song, translated), 200, song)!;
  assert.deepEqual(geniusReferents(read, "pt"), geniusReferents(translated, "pt"));
  assert.deepEqual(geniusTranslationRequests(read, "pt"), []);
});
