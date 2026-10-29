"""Writes the Shazam signature fixtures for RecognizeSignatureTest.

    python make_fixtures.py

Needs git, a Rust toolchain (cargo) and a Python with shazamio-core 2.0.0 and
numpy (`pip install shazamio-core==2.0.0 numpy`). For each fixture it:

1. synthesises a few seconds of audio (seeded, so reruns give the same WAV);
2. asks the PyPI wheel (`shazamio_core.Recognizer.recognize_path`) for its
   signature of the WAV;
3. runs signature-tool, which builds shazamio-core 2.0.0's own fingerprinting
   sources, to get the 16 kHz samples that pipeline feeds the signature
   generator (shazamio-core always resamples, even 16 kHz to 16 kHz, so they
   are not the WAV's samples) and the signature of those samples alone;
4. checks the three signatures are the same bytes, then writes
   `<name>.pcm` (signed 16-bit little-endian mono at 16 kHz) and `<name>.uri`
   (the wheel's data URI) to src/test/resources/fixtures/shazam.
"""

import asyncio
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
import shazamio_core

HERE = Path(__file__).resolve().parent
TOOL = HERE / "signature-tool"
OUT = HERE.parent.parent / "resources" / "fixtures" / "shazam"
SHAZAMIO_CORE = "https://github.com/shazamio/shazamio-core.git"
SHAZAMIO_CORE_TAG = "2.0.0"
RATE = 16_000


def tone(t, frequency, start, end, level):
    """A note with a short fade in and out, sounding from `start` to `end` seconds."""
    envelope = np.clip(np.minimum(t - start, end - t) / 0.03, 0, 1)
    return level * envelope * np.sin(2 * np.pi * frequency * t)


def chord_song():
    """4 s of notes that change every quarter second, across all four bands."""
    t = np.arange(4 * RATE) / RATE
    rng = np.random.default_rng(767)
    signal = np.zeros_like(t)
    for step in range(16):
        start = step * 0.25
        for frequency in rng.choice([330, 392, 440, 523, 659, 784, 1046, 1568, 2093, 3136, 4186, 4699], 3):
            signal += tone(t, frequency * (1 + rng.uniform(-0.01, 0.01)), start, start + 0.3, 0.12)
    return signal + rng.normal(0, 0.002, t.size)


def pause():
    """4 s of notes in every band with 2.6 s of silence in the middle, so each band's
    peaks jump more than 255 FFT passes and the signature has to mark the jump."""
    t = np.arange(4 * RATE) / RATE
    rng = np.random.default_rng(768)
    signal = np.zeros_like(t)
    for start in [0.0, 0.3, 3.2, 3.5]:
        for frequency in [rng.choice([294, 349, 440]), rng.choice([700, 900, 1100]), rng.choice([2000, 2500, 3000]), rng.choice([3700, 4500, 5000])]:
            signal += tone(t, frequency, start, start + 0.3, 0.1)
    return signal


FIXTURES = {"chord-song": chord_song, "pause": pause}


def write_wav(path, signal):
    samples = np.clip(np.round(signal * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes(samples.tobytes())


async def wheel_signature(path):
    signature = await shazamio_core.Recognizer().recognize_path(str(path))
    return signature.signature.uri


def remove_tree(path):
    # Git marks its objects read-only, which Windows won't delete as they are.
    def make_writable(function, name, _):
        os.chmod(name, stat.S_IWRITE)
        function(name)

    shutil.rmtree(path, onerror=make_writable)


def build_tool(target):
    source = TOOL / "shazamio-core"
    if source.exists():
        remove_tree(source)
    subprocess.run(["git", "-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", SHAZAMIO_CORE_TAG, SHAZAMIO_CORE, str(source)], check=True)
    shutil.copy(source / "Cargo.lock", TOOL / "Cargo.lock")
    env = dict(os.environ, CARGO_TARGET_DIR=str(target))
    subprocess.run(["cargo", "build", "--release", "--quiet", "--manifest-path", str(TOOL / "Cargo.toml")], check=True, env=env)
    remove_tree(source)
    (TOOL / "Cargo.lock").unlink()
    return target / "release" / ("wave-signature-tool" + (".exe" if sys.platform == "win32" else ""))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        temporary = Path(temporary)
        tool = build_tool(temporary / "target")
        for name, make in FIXTURES.items():
            wav = temporary / f"{name}.wav"
            pcm = OUT / f"{name}.pcm"
            write_wav(wav, make())
            from_wheel = asyncio.run(wheel_signature(wav))
            run = subprocess.run([str(tool), str(wav), str(pcm)], check=True, capture_output=True, text=True)
            from_file, from_samples = run.stdout.split()
            if not from_wheel == from_file == from_samples:
                sys.exit(f"{name}: signature-tool disagrees with the shazamio-core wheel")
            (OUT / f"{name}.uri").write_text(from_wheel + "\n", newline="\n")
            print(f"{name}: {pcm.stat().st_size // 2} samples, {len(from_wheel)} characters of URI")


if __name__ == "__main__":
    main()
