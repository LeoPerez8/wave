#!/usr/bin/env bash
# Regenerates the tiny audio fixtures used by the scanner's JVM tests.
# Every tagged fixture carries the same tags (see TAGS) and the teal cover, so
# the tests can assert one set of expected values per format.
#   apps/mobile/modules/wave-native/android/src/test/fixtures-src/generate.sh
# Requires ffmpeg with libmp3lame, libvorbis and libopus.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../resources/fixtures"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }

ff -f lavfi -i "color=c=0x14B8A6:s=32x32,format=rgb24" -frames:v 1 "$tmp/cover.png"
ff -f lavfi -i "color=c=0xF5B83D:s=32x32,format=rgb24" -frames:v 1 "$tmp/cover-gold.png"
# Kept so tests can compare extracted artwork byte for byte.
cp "$tmp/cover.png" "$out/cover.png"
# 1.5 s of a quiet tone: long enough for a stable duration, small enough to commit.
ff -f lavfi -i "sine=frequency=440:duration=1.5:sample_rate=8000" -af "volume=0.1" -ac 1 "$tmp/tone.wav"
ff -f lavfi -i "sine=frequency=440:duration=1.5:sample_rate=48000" -af "volume=0.1" -ac 1 "$tmp/tone48k.wav"
# MP3 uses a standard MPEG-1 rate rather than 8 kHz MPEG-2.5, which not every parser handles.
ff -f lavfi -i "sine=frequency=440:duration=1.5:sample_rate=44100" -af "volume=0.1" -ac 1 "$tmp/tone44k.wav"

TAGS=(
  -metadata "title=Wave Fixture"
  -metadata "artist=Fixture Artist"
  -metadata "album=Fixture Album"
  -metadata "album_artist=Fixture Album Artist"
  -metadata "genre=Ambient"
  -metadata "date=2024"
  -metadata "track=3/12"
  -metadata "disc=1/2"
)

with_cover() { # <cover> -> args that embed it as the attached picture
  echo -i "$1" -map 0:a -map 1:v -disposition:v attached_pic
}

# MP3 (ID3v2.4) with cover
ff -i "$tmp/tone44k.wav" $(with_cover "$tmp/cover.png") -c:a libmp3lame -b:a 32k -c:v png \
  -id3v2_version 4 "${TAGS[@]}" "$out/tagged.mp3"
# Same cover in a second file, to test that artwork is stored once per unique image
ff -i "$tmp/tone44k.wav" $(with_cover "$tmp/cover.png") -c:a libmp3lame -b:a 32k -c:v png \
  -id3v2_version 4 -metadata "title=Same Cover" -metadata "artist=Fixture Artist" "$out/same-cover.mp3"
# Compilation flag, no album artist
ff -i "$tmp/tone44k.wav" $(with_cover "$tmp/cover-gold.png") -c:a libmp3lame -b:a 32k -c:v png \
  -id3v2_version 4 -metadata "title=Compiled" -metadata "artist=Someone" \
  -metadata "album=Some Compilation" -metadata "compilation=1" "$out/compilation.mp3"
# No tags at all
ff -i "$tmp/tone44k.wav" -c:a libmp3lame -b:a 32k -map_metadata -1 -write_xing 1 "$out/untagged.mp3"

# FLAC with cover
ff -i "$tmp/tone.wav" $(with_cover "$tmp/cover.png") -c:a flac -c:v png "${TAGS[@]}" "$out/tagged.flac"
# M4A: AAC and ALAC, with cover
ff -i "$tmp/tone.wav" $(with_cover "$tmp/cover.png") -c:a aac -b:a 16k -c:v png "${TAGS[@]}" "$out/tagged-aac.m4a"
ff -i "$tmp/tone.wav" $(with_cover "$tmp/cover.png") -c:a alac -c:v png "${TAGS[@]}" "$out/tagged-alac.m4a"
# OGG Vorbis and Opus. ffmpeg can't mux a cover stream into Ogg, so the cover
# goes in as a METADATA_BLOCK_PICTURE comment (a base64 FLAC picture block).
picture="$(python3 - "$tmp/cover.png" <<'PY'
import base64, struct, sys
data = open(sys.argv[1], "rb").read()
mime = b"image/png"
block = struct.pack(">II", 3, len(mime)) + mime + struct.pack(">IIIIII", 0, 32, 32, 24, 0, len(data)) + data
print(base64.b64encode(block).decode())
PY
)"
ff -i "$tmp/tone.wav" -c:a libvorbis -q:a 0 "${TAGS[@]}" -metadata "METADATA_BLOCK_PICTURE=$picture" "$out/tagged.ogg"
ff -i "$tmp/tone48k.wav" -c:a libopus -b:a 8k "${TAGS[@]}" -metadata "METADATA_BLOCK_PICTURE=$picture" "$out/tagged.opus"
# Opus inside a .ogg file
cp "$out/tagged.opus" "$out/opus-in-ogg.ogg"
# WAV with a LIST/INFO chunk
ff -i "$tmp/tone.wav" -c:a pcm_s16le -metadata "title=Wave Fixture" -metadata "artist=Fixture Artist" \
  -metadata "album=Fixture Album" -metadata "genre=Ambient" -metadata "date=2024" "$out/tagged.wav"

ls -l "$out"
