"""Writes the engine's test files: one second of a known stereo signal in each format.

The left channel is an exponential sweep from 110 Hz to 3,520 Hz, the right a chirp from 200 to
800 Hz, so no two windows look alike and a misplaced sample shows up as a lag. The Rust tests
compute the same signal (`tests/common/mod.rs`) and compare what the engine decodes with it.

Usage: python -I make.py <ffmpeg> <this folder>
"""
import math, os, struct, subprocess, sys, tempfile, wave

ffmpeg, out = sys.argv[1], sys.argv[2]
SECONDS = 1.0


def sample(n, rate):
    t = n / rate
    k = math.log(3520.0 / 110.0)
    left = 0.5 * math.sin(2 * math.pi * 110.0 * SECONDS / k * (math.exp(t / SECONDS * k) - 1))
    right = 0.4 * math.sin(2 * math.pi * (200.0 * t + 300.0 * t * t))
    return left, right


def write_wav(path, rate):
    frames = bytearray()
    for n in range(int(rate * SECONDS)):
        left, right = sample(n, rate)
        frames += struct.pack("<hh", round(left * 32767), round(right * 32767))
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))


def encode(source, target, *codec):
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", source, "-map_metadata", "-1",
         "-fflags", "+bitexact", *codec, os.path.join(out, target)],
        check=True,
    )


write_wav(os.path.join(out, "tone.wav"), 22050)
encode(os.path.join(out, "tone.wav"), "tone.flac", "-c:a", "flac")
with tempfile.TemporaryDirectory() as scratch:
    cd = os.path.join(scratch, "44100.wav")
    write_wav(cd, 44100)
    encode(cd, "tone.mp3", "-c:a", "libmp3lame", "-b:a", "128k")
    encode(cd, "tone.m4a", "-c:a", "aac", "-b:a", "128k")
    encode(cd, "tone.ogg", "-c:a", "libvorbis", "-q:a", "4")
    opus = os.path.join(scratch, "48000.wav")
    write_wav(opus, 48000)
    encode(opus, "tone.opus", "-c:a", "libopus", "-b:a", "96k")
