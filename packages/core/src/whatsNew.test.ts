import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WHATS_NEW_RETRY_MS,
  mergeReleaseNotes,
  nextWhatsNewStep,
  readPublishedNotes,
  whatsNewNotesUrl,
  type PublishedRelease,
  type WhatsNewState,
} from "./index.ts";

const release = (
  version: string,
  en: { new?: string[]; fixes?: string[] },
  ptBr: { new?: string[]; fixes?: string[] } = en,
): PublishedRelease => ({
  version,
  notes: {
    en: { new: en.new ?? [], fixes: en.fixes ?? [] },
    "pt-BR": { new: ptBr.new ?? [], fixes: ptBr.fixes ?? [] },
  },
});

describe("mergeReleaseNotes", () => {
  it("groups several versions into one set of notes, newest first, under the newest version", () => {
    const merged = mergeReleaseNotes(
      [
        release("0.47.1", { fixes: ["Lyrics scroll again"] }),
        release("0.47.0-ti", { new: ["Sleep timer fades out"], fixes: ["Covers load"] }),
      ],
      "en",
    );
    assert.deepEqual(merged, {
      version: "0.47.1",
      new: ["Sleep timer fades out"],
      fixes: ["Lyrics scroll again", "Covers load"],
    });
  });

  it("reads the phone's language, and a fallback English title stays as it came", () => {
    const merged = mergeReleaseNotes(
      [
        release(
          "0.47.0",
          { new: ["Sleep timer fades out", "Queue reorder"] },
          { new: ["O timer para dormir diminui aos poucos", "Queue reorder"] },
        ),
      ],
      "pt-BR",
    );
    assert.deepEqual(merged?.new, ["O timer para dormir diminui aos poucos", "Queue reorder"]);
  });

  it("lists a line two releases share once", () => {
    const merged = mergeReleaseNotes(
      [
        release("0.47.1", { fixes: ["Covers load"] }),
        release("0.47.0", { fixes: ["Covers load"] }),
      ],
      "en",
    );
    assert.deepEqual(merged?.fixes, ["Covers load"]);
  });

  it("has nothing to say when no release has a line", () => {
    assert.equal(mergeReleaseNotes([], "en"), null);
    assert.equal(mergeReleaseNotes([release("0.47.0", {})], "pt-BR"), null);
  });
});

describe("readPublishedNotes", () => {
  it("reads the service's answer", () => {
    const sections = { new: ["A"], fixes: [] };
    assert.deepEqual(
      readPublishedNotes({
        releases: [{ version: "0.47.0", notes: { en: sections, "pt-BR": sections } }],
      }),
      [release("0.47.0", { new: ["A"] })],
    );
    assert.deepEqual(readPublishedNotes({ releases: [] }), []);
  });

  it("gives a release without Portuguese its English lines", () => {
    assert.deepEqual(
      readPublishedNotes({
        releases: [{ version: "0.47.0", notes: { en: { new: ["A"], fixes: ["B"] } } }],
      }),
      [release("0.47.0", { new: ["A"], fixes: ["B"] })],
    );
  });

  it("refuses an answer it can't read", () => {
    for (const answer of [null, "x", {}, { releases: "x" }, { releases: [{ version: 1 }] }]) {
      assert.equal(readPublishedNotes(answer), null);
    }
  });
});

describe("whatsNewNotesUrl", () => {
  it("asks the service the manifest comes from, for what came after the seen version", () => {
    assert.equal(
      whatsNewNotesUrl({
        manifestUrl: "https://updates.example/v1/manifest",
        channel: "ti",
        from: "0.46.2",
        to: "0.47.0-ti",
      }),
      "https://updates.example/v1/notes?channel=ti&from=0.46.2&to=0.47.0-ti",
    );
  });

  it("has no address without a channel the service knows or a manifest address", () => {
    const asked = { from: "0.46.2", to: "0.47.0" };
    const manifestUrl = "https://updates.example/v1/manifest";
    assert.equal(whatsNewNotesUrl({ ...asked, manifestUrl, channel: "none" }), null);
    assert.equal(whatsNewNotesUrl({ ...asked, manifestUrl, channel: null }), null);
    assert.equal(whatsNewNotesUrl({ ...asked, manifestUrl: undefined, channel: "main" }), null);
    assert.equal(whatsNewNotesUrl({ ...asked, manifestUrl: "https://x/y", channel: "main" }), null);
  });
});

describe("nextWhatsNewStep", () => {
  const state: WhatsNewState = {
    runningVersion: "0.47.0",
    seenVersion: "0.46.2",
    visible: true,
    nowPlayingShown: false,
    cardOpen: false,
    fetching: false,
    notesReady: false,
    showing: false,
    now: 1_000_000_000,
    lastFailureAt: null,
  };

  it("remembers the version of a fresh install and shows nothing", () => {
    assert.equal(nextWhatsNewStep({ ...state, seenVersion: null }), "remember");
  });

  it("is finished once the running version has been seen", () => {
    assert.equal(nextWhatsNewStep({ ...state, seenVersion: "0.47.0" }), "finished");
  });

  it("treats a ti version and a main version as one sequence", () => {
    assert.equal(nextWhatsNewStep({ ...state, seenVersion: "0.46.3-ti" }), "fetch");
    assert.equal(nextWhatsNewStep({ ...state, seenVersion: "0.47.1-ti" }), "finished");
  });

  it("compares versions as numbers", () => {
    assert.equal(
      nextWhatsNewStep({ ...state, runningVersion: "0.46.10", seenVersion: "0.46.9" }),
      "fetch",
    );
  });

  it("stays quiet after a rollback to an older version", () => {
    assert.equal(nextWhatsNewStep({ ...state, runningVersion: "0.46.0" }), "finished");
  });

  it("is finished with a running version it can't read, and starts over from a stored one", () => {
    assert.equal(nextWhatsNewStep({ ...state, runningVersion: null }), "finished");
    assert.equal(nextWhatsNewStep({ ...state, runningVersion: "dev" }), "finished");
    assert.equal(nextWhatsNewStep({ ...state, seenVersion: "garbage" }), "remember");
  });

  it("fetches only while Wave is visible, and once at a time", () => {
    assert.equal(nextWhatsNewStep(state), "fetch");
    assert.equal(nextWhatsNewStep({ ...state, visible: false }), "wait");
    assert.equal(nextWhatsNewStep({ ...state, fetching: true }), "wait");
  });

  it("waits a while after a failed fetch before asking again", () => {
    const failed = { ...state, lastFailureAt: state.now };
    assert.equal(nextWhatsNewStep(failed), "wait");
    assert.equal(nextWhatsNewStep({ ...failed, now: state.now + WHATS_NEW_RETRY_MS }), "fetch");
    assert.equal(nextWhatsNewStep({ ...failed, now: state.now - 1 }), "fetch");
  });

  it("shows ready notes when nothing is in the way", () => {
    const ready = { ...state, notesReady: true };
    assert.equal(nextWhatsNewStep(ready), "show");
    assert.equal(nextWhatsNewStep({ ...ready, visible: false }), "wait");
    assert.equal(nextWhatsNewStep({ ...ready, nowPlayingShown: true }), "wait");
    assert.equal(nextWhatsNewStep({ ...ready, cardOpen: true }), "wait");
  });

  it("takes the card away when Now Playing comes up, and leaves it otherwise", () => {
    const showing = { ...state, notesReady: true, showing: true, cardOpen: true };
    assert.equal(nextWhatsNewStep(showing), "wait");
    assert.equal(nextWhatsNewStep({ ...showing, visible: false }), "wait");
    assert.equal(nextWhatsNewStep({ ...showing, nowPlayingShown: true }), "hide");
  });
});
