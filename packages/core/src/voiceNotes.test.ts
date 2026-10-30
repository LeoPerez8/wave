import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isVoiceNoteOrRecording } from "./index.ts";

const STORAGE = "/storage/emulated/0";
const WHATSAPP = `${STORAGE}/Android/media/com.whatsapp/WhatsApp/Media`;

/** A tagged, full-length song unless a test says otherwise. */
const file = (path: string, durationMs = 214_000, artist: string | null = "Radiohead") => ({
  path,
  durationMs,
  artist,
});

describe("isVoiceNoteOrRecording", () => {
  test("a file in a folder WhatsApp or Android keeps voice notes, recordings or calls in isn't music", () => {
    for (const path of [
      `${WHATSAPP}/WhatsApp Voice Notes/202604/note.opus`,
      `${WHATSAPP}/WhatsApp Audio/song.mp3`,
      `${STORAGE}/WhatsApp Business/Media/WhatsApp Business Voice Notes/202604/a.opus`,
      `${STORAGE}/Recordings/Meeting.m4a`,
      `${STORAGE}/Music/Recordings/idea.m4a`,
      `${STORAGE}/Call/Mum.m4a`,
      `${STORAGE}/Recordings/Call recordings/Mum.m4a`,
      `${STORAGE}/MIUI/sound_recorder/call_rec/Mum.mp3`,
    ]) {
      assert.equal(isVoiceNoteOrRecording(file(path)), true, path);
    }
  });

  test("an ordinary song is music, wherever its folder's name mentions a call or a recording", () => {
    for (const path of [
      `${STORAGE}/Music/Radiohead/OK Computer/03 Subterranean Homesick Alien.flac`,
      `${STORAGE}/Music/Live Recordings 1999/01 Airbag.mp3`,
      `${STORAGE}/Music/Call Me Maybe/01 Call Me Maybe.mp3`,
      `${STORAGE}/Download/Recording Artist - Song.mp3`,
    ]) {
      assert.equal(isVoiceNoteOrRecording(file(path)), false, path);
    }
  });

  test("a file named the way WhatsApp or a voice recorder names them isn't music, in any folder", () => {
    for (const name of [
      "AUD-20260412-WA0003.opus",
      "PTT-20260412-WA0017.opus",
      "aud-20260412-wa0003.m4a",
      "Recording_20260412_183012.m4a",
      "Recording 12.m4a",
      "Voice 001.m4a",
      "Voice_260412_183012.m4a",
      "Rec_20260412_183012.mp3",
      "Call recording Mum_260412_183012.m4a",
    ]) {
      assert.equal(isVoiceNoteOrRecording(file(`${STORAGE}/Music/${name}`)), true, name);
    }
  });

  test("a song whose name only starts like a recording's is music", () => {
    for (const name of [
      "AUD-Intro.mp3",
      "Voice of the Voiceless.mp3",
      "Recordings Of Rain - Song.mp3",
      "Rec Room.mp3",
      "Call Me Maybe.mp3",
    ]) {
      assert.equal(isVoiceNoteOrRecording(file(`${STORAGE}/Music/${name}`)), false, name);
    }
  });

  test("a file shorter than 30 seconds with no artist tag isn't music", () => {
    for (const artist of [null, "", "  ", "Unknown Artist", "<unknown>"]) {
      const path = `${STORAGE}/Music/Downloads/clip.mp3`;
      assert.equal(isVoiceNoteOrRecording(file(path, 29_999, artist)), true, String(artist));
    }
  });

  test("a short track with an artist tag, a 30-second file and one whose length is unknown are music", () => {
    const path = `${STORAGE}/Music/Kendrick Lamar/DAMN/01 BLOOD.flac`;
    assert.equal(isVoiceNoteOrRecording(file(path, 12_000, "Kendrick Lamar")), false);
    assert.equal(isVoiceNoteOrRecording(file(path, 30_000, null)), false);
    assert.equal(isVoiceNoteOrRecording(file(path, 0, null)), false);
  });
});
