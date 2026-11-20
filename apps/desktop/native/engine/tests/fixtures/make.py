"""Writes the engine's test files: one second of a known stereo signal in each format.

The left channel is an exponential sweep from 110 Hz to 3,520 Hz, the right a chirp from 200 to
800 Hz, so no two windows look alike and a misplaced sample shows up as a lag. The Rust tests
compute the same signal (`tests/common/mod.rs`) and compare what the engine decodes with it.

Usage: python -I make.py <ffmpeg> <this folder> [fdkaac]

The optional fdkaac binary regenerates the HE-AAC fixtures and their FFmpeg PCM references.
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
encode(os.path.join(out, "tone.wav"), "tone-alac.m4a", "-c:a", "alac")
with tempfile.TemporaryDirectory() as scratch:
    cd = os.path.join(scratch, "44100.wav")
    write_wav(cd, 44100)
    encode(cd, "tone.mp3", "-c:a", "libmp3lame", "-b:a", "128k")
    encode(cd, "tone.m4a", "-c:a", "aac", "-b:a", "128k")
    encode(cd, "tone.ogg", "-c:a", "libvorbis", "-q:a", "4")
    opus = os.path.join(scratch, "48000.wav")
    write_wav(opus, 48000)
    encode(opus, "tone.opus", "-c:a", "libopus", "-b:a", "96k")


def smpb_only(source, target):
    """Writes [source] with its edit list hidden and an iTunSMPB tag instead, so the trim must
    come from the iTunes tag alone (1,024 frames of priming, 956 of padding, 44,100 of audio)."""
    data = open(source, "rb").read()

    def box(kind, body):
        return struct.pack(">I", len(body) + 8) + kind + body

    smpb = b" 00000000 00000400 000003BC 000000000000AC44"
    tag = box(b"----", box(b"mean", bytes(4) + b"com.apple.iTunes")
              + box(b"name", bytes(4) + b"iTunSMPB") + box(b"data", struct.pack(">II", 1, 0) + smpb))
    handler = box(b"hdlr", bytes(8) + b"mdirappl" + bytes(9))
    metadata = box(b"udta", box(b"meta", bytes(4) + handler + box(b"ilst", tag)))
    offset = 0
    while offset + 8 <= len(data):
        size, kind = struct.unpack_from(">I4s", data, offset)
        if kind == b"moov":
            # ffmpeg writes moov after mdat, so resizing it moves no chunk offset.
            moov = data[offset + 8:offset + size].replace(b"elst", b"free")
            parts, at = [], 0
            while at + 8 <= len(moov):
                length = struct.unpack_from(">I", moov, at)[0]
                if moov[at + 4:at + 8] != b"udta":
                    parts.append(moov[at:at + length])
                at += length
            moov = box(b"moov", b"".join(parts) + metadata)
            open(target, "wb").write(data[:offset] + moov + data[offset + size:])
            return
        offset += size


smpb_only(os.path.join(out, "tone.m4a"), os.path.join(out, "tone-smpb.m4a"))


def make_he_aac(fdkaac):
    # Separate low and high tones in each channel. The high tones are above the 24 kHz core's
    # Nyquist frequency, so the PCM reference catches a decoder that drops SBR.
    signal = (
        "aevalsrc=0.25*sin(2*PI*440*t)+0.1*sin(2*PI*13000*t)"
        "|0.24*sin(2*PI*660*t)+0.09*sin(2*PI*14500*t):s=48000:d=1"
    )
    with tempfile.TemporaryDirectory() as scratch:
        source = os.path.join(scratch, "he-source.wav")
        adts = os.path.join(scratch, "audio.aac")
        subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", signal,
                        "-c:a", "pcm_s16le", source], check=True)
        # fdkaac 1.0.0 with FDK AAC 2.0.3 reports 0x9e1 and 0xde1 core priming frames.
        for version, profile, bitrate, delay in [("v1", 5, 48000, 5058), ("v2", 29, 32000, 7106)]:
            target = os.path.join(out, f"tone-he-aac-{version}")
            subprocess.run([fdkaac, "-S", "-p", str(profile), "-b", str(bitrate), "-G", "2",
                            "--include-sbr-delay", "--title", f"HE-AAC {version} Tone",
                            "-o", target + ".m4a", source], check=True)
            # Use ADTS to compare the same raw access units without the container applying
            # its own trim. Save only the reference window used by the Rust test.
            subprocess.run([ffmpeg, "-v", "error", "-y", "-ignore_editlist", "1", "-i",
                            target + ".m4a", "-c:a", "copy", "-f", "adts", adts], check=True)
            pcm = subprocess.check_output([ffmpeg, "-v", "error", "-i", adts, "-f", "f32le", "-"])
            first = (delay + 12000) * 8
            with open(target + ".f32le", "wb") as golden:
                golden.write(pcm[first:first + 512 * 8])


if len(sys.argv) > 3:
    make_he_aac(sys.argv[3])
