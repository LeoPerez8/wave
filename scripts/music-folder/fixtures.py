"""Throwaway MP3s for replace.test.ts (needs imageio-ffmpeg and mutagen).

  python -I fixtures.py <empty folder>

Writes 12-second pink noise songs, encoded with the LAME that ships with
imageio-ffmpeg, and prints their names as JSON:

  old.mp3        the low-quality song in the music folder: 128 kbps, tagged
                 with title, artist, album, genre, lyrics, a cover and an ID3v1 tag
  good.mp3       a genuine 320 kbps copy: its spectrum reaches ~20 kHz, with the
                 peer's own tags and cover
  upscale.mp3    the 128 kbps file re-encoded at 320 kbps: 320 kbps in every
                 frame, but its spectrum stops where the 128 kbps one did
  vbr.mp3        a V0 encode: full band, but not 320 kbps throughout
  longer.mp3     a genuine 320 kbps copy 8 seconds longer
  live.mp3       good.mp3's audio tagged as a live version
"""

import json
import os
import subprocess
import sys

import imageio_ffmpeg
from mutagen.id3 import APIC, ID3, TALB, TCON, TIT2, TPE1, TRCK, USLT

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360f8cf00000301010018dd8db00000000049454e44ae426082"
)


def ffmpeg(*args):
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def noise(path, seconds, *encode, seed=1):
    ffmpeg(
        "-f", "lavfi", "-i", f"anoisesrc=d={seconds}:c=pink:r=44100:a=0.3:s={seed}",
        "-ac", "2", "-c:a", "libmp3lame", *encode, "-id3v2_version", "0", path,
    )


def tag(path, title, artist, album, cover, extra=()):
    tags = ID3()
    tags.add(TIT2(encoding=3, text=[title]))
    tags.add(TPE1(encoding=3, text=[artist]))
    tags.add(TALB(encoding=3, text=[album]))
    tags.add(APIC(encoding=3, mime="image/png", type=3, desc="Cover", data=cover))
    for frame in extra:
        tags.add(frame)
    tags.save(path, v1=2, v2_version=3)


def main():
    folder = sys.argv[1]
    at = lambda name: os.path.join(folder, name)
    noise(at("old.mp3"), 12, "-b:a", "128k", seed=1)
    tag(at("old.mp3"), "Arabella", "Arctic Monkeys", "AM", PNG + b"old", [
        TCON(encoding=3, text=["Alternative"]),
        TRCK(encoding=3, text=["1"]),
        USLT(encoding=3, lang="eng", desc="", text="Made of steel\nand starlight"),
    ])
    noise(at("good.mp3"), 12, "-b:a", "320k", seed=2)
    tag(at("good.mp3"), "Arabella", "Arctic Monkeys", "AM (Peer Rip)", PNG + b"peer")
    noise(at("lossy.mp3"), 12, "-b:a", "128k", seed=3)
    ffmpeg("-i", at("lossy.mp3"), "-c:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "0", at("upscale.mp3"))
    os.remove(at("lossy.mp3"))
    tag(at("upscale.mp3"), "Arabella", "Arctic Monkeys", "AM", PNG)
    noise(at("vbr.mp3"), 12, "-q:a", "0", seed=4)
    noise(at("longer.mp3"), 20, "-b:a", "320k", seed=5)
    with open(at("good.mp3"), "rb") as source, open(at("live.mp3"), "wb") as copy:
        copy.write(source.read())
    tag(at("live.mp3"), "Arabella (Live at Glastonbury)", "Arctic Monkeys", "Live", PNG)
    sys.stdout.write(json.dumps(sorted(os.listdir(folder))))


if __name__ == "__main__":
    main()
