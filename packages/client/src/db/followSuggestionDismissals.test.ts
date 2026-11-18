import { test } from "node:test";
import assert from "node:assert/strict";
import { followArtistKey } from "@wave/core";
import { openTestDatabase, reopenTestDatabase, closeTestDatabase } from "./testDatabase.ts";
import {
  dismissFollowSuggestion,
  selectDismissedFollowSuggestions,
  undoFollowSuggestionDismissal,
} from "./followSuggestionDismissals.ts";

test("a dismissed suggestion stays dismissed after a restart", async () => {
  const db = await openTestDatabase();
  assert.deepEqual(selectDismissedFollowSuggestions(db), []);
  dismissFollowSuggestion(db, followArtistKey("The Beyoncé"), 100);
  dismissFollowSuggestion(db, followArtistKey("ABBA"), 200);
  const reopened = await reopenTestDatabase(db);
  assert.deepEqual(selectDismissedFollowSuggestions(reopened), ["abba", "beyonce"]);
  closeTestDatabase(reopened);
});

test("Undo takes the dismissal back, and the artist can be dismissed again", async () => {
  const db = await openTestDatabase();
  dismissFollowSuggestion(db, "abba", 100);
  dismissFollowSuggestion(db, "aurora", 100);
  undoFollowSuggestionDismissal(db, "abba", 150);
  assert.deepEqual(selectDismissedFollowSuggestions(db), ["aurora"]);
  dismissFollowSuggestion(db, "abba", 200);
  dismissFollowSuggestion(db, "aurora", 300);
  assert.deepEqual(selectDismissedFollowSuggestions(db), ["abba", "aurora"]);
  closeTestDatabase(db);
});
