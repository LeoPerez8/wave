"""Audio checks and the in-place write for replace.ts (issue #161).

Needs numpy, miniaudio and mutagen (`pip install numpy miniaudio mutagen`).

  python -I audio.py probe     stdin: JSON list of paths
  python -I audio.py replace   stdin: JSON {"target", "audio", "expectedSha256", "backup"}
  python -I audio.py report <music folder> <csv>

Output is JSON on stdout (ASCII only, so the console code page doesn't matter).

probe measures each MP3:
- `mp3`: every MPEG frame read, with the rules of Wave's native check
  (Mp3Validation.kt): after the ID3v2 tag and before APEv2/ID3v1 tags, only
  complete MPEG-1 Layer III frames at 320 kbps with one sample rate.
- `cutoffHz`: the spectrum cutoff exactly as Musicas-quality-report.csv measured
  it (see `cutoff`). None means no cliff, which the report counts as OK.
- the title, artist and album as Wave's scanner reads them (tags.py).

replace writes the new file's audio between the old file's own tags (ID3v2 in
front, APEv2/ID3v1 behind), so the old title, artist, album, genre, lyrics and
artwork stay and the peer's tags go. It writes `~syncthing~<name>.tmp` beside
the old file (Syncthing ignores that prefix), reads it back, copies the old
file to the backup path, and swaps the copy in with os.replace.

report rewrites the quality report CSV for the whole folder with the same
method and verdicts.
"""

import csv
import hashlib
import json
import os
import shutil
import sys
from concurrent.futures import ProcessPoolExecutor

sys.dont_write_bytecode = True  # importing tags.py leaves no __pycache__ in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import miniaudio  # noqa: E402
import numpy as np  # noqa: E402
from mutagen.mp3 import MP3  # noqa: E402

from tags import first, load  # noqa: E402


# ---- The quality report's cutoff ------------------------------------------------------


def cutoff(path):
    """The highest 250 Hz band edge with a 10 dB cliff across 1 kHz either side.

    This is the method that produced Musicas-quality-report.csv: the middle
    60 seconds, decoded to mono, averaged over 4096-point Hann windows. None
    when no cliff is found above 10.25 kHz.
    """
    with open(path, "rb") as f:
        # decode (not decode_file), as the report did: the two start the stream differently.
        dec = miniaudio.decode(f.read(), output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1)
    sr = dec.sample_rate
    x = np.frombuffer(dec.samples, dtype=np.float32)
    n = len(x)
    seg = x[max(0, n // 2 - 30 * sr): n // 2 + 30 * sr]
    N = 4096
    frames = len(seg) // N
    if frames < 10:
        raise ValueError("too short")
    w = np.hanning(N)
    S = np.zeros(N // 2 + 1)
    for i in range(frames):
        S += np.abs(np.fft.rfft(seg[i * N:(i + 1) * N] * w)) ** 2
    db = 10 * np.log10(S / frames + 1e-20)
    f = np.fft.rfftfreq(N, 1 / sr)
    bands = np.arange(0, sr / 2, 250)
    lv = np.array([db[(f >= b) & (f < b + 250)].mean() for b in bands])
    for i in range(len(bands) - 4, 40, -1):
        if lv[i - 4:i].mean() - lv[i:i + 4].mean() >= 10:
            return float(bands[i])
    return None


def verdict(cut):
    if cut is None or cut >= 19500:
        return "OK - best YouTube source (~20 kHz)"
    if cut >= 17500:
        return "Medium (~18-19 kHz)"
    if cut >= 15500:
        return "Weak - 128k-class source (~16 kHz)"
    return "Poor - low-quality upload (<15.5 kHz)"


# ---- MPEG frames --------------------------------------------------------------------


class Invalid(Exception):
    pass


def regions(data):
    """(start, end) of the audio: after a leading ID3v2 tag, before APEv2 and ID3v1 tags."""
    start, end = 0, len(data)
    if end >= 10 and data[:3] == b"ID3":
        if data[3] not in (2, 3, 4) or any(b & 0x80 for b in data[6:10]):
            raise Invalid("invalid ID3 header")
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        if size > 16 * 1024 * 1024:
            raise Invalid("ID3 tag is too large")
        start = 10 + size + (10 if data[3] == 4 and data[5] & 0x10 else 0)
        if start > end:
            raise Invalid("incomplete ID3 tag")
    if end - start >= 128 and data[end - 128:end - 125] == b"TAG":
        end -= 128
    if end - start >= 32 and data[end - 32:end - 24] == b"APETAGEX":
        size = int.from_bytes(data[end - 20:end - 16], "little")
        if size < 32 or size > end - start:
            raise Invalid("invalid APE tag")
        end -= size
        if end - start >= 32 and data[end - 32:end - 24] == b"APETAGEX":
            end -= 32
    return start, end


def frames(data):
    """Every frame between the tags must be MPEG-1 Layer III at 320 kbps."""
    start, end = regions(data)
    position, count, sample_rate = start, 0, 0
    while position < end:
        if end - position < 4:
            raise Invalid("truncated MPEG frame")
        header = int.from_bytes(data[position:position + 4], "big")
        if header >> 21 != 0x7FF or (header >> 19) & 3 != 3 or (header >> 17) & 3 != 1:
            raise Invalid("not a complete MPEG-1 Layer III recording")
        if (header >> 12) & 15 != 14:
            raise Invalid("not 320 kbps in every frame")
        rate = {0: 44100, 1: 48000, 2: 32000}.get((header >> 10) & 3)
        if rate is None:
            raise Invalid("invalid MPEG sample rate")
        if sample_rate and rate != sample_rate:
            raise Invalid("the sample rate changes inside the recording")
        sample_rate = rate
        size = 144 * 320000 // rate + ((header >> 9) & 1)
        if position + size > end:
            raise Invalid("truncated MPEG frame")
        position += size
        count += 1
    if count < 2:
        raise Invalid("no complete MP3 recording")
    return {
        "ok": True,
        "durationMs": round(count * 1152 * 1000 / sample_rate),
        "sampleRate": sample_rate,
        "frames": count,
    }


# ---- Commands ------------------------------------------------------------------------


def probe(path):
    with open(path, "rb") as f:
        data = f.read()
    out = {"path": path, "sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    try:
        info = MP3(path).info
        out["durationMs"] = round(info.length * 1000)
        out["bitrateKbps"] = info.bitrate // 1000
    except Exception:
        out["durationMs"] = None
        out["bitrateKbps"] = None
    try:
        out["mp3"] = frames(data)
    except Invalid as error:
        out["mp3"] = {"ok": False, "error": str(error)}
    try:
        out["cutoffHz"] = cutoff(path)
    except Exception as error:
        out["cutoffHz"] = None
        out["cutoffError"] = str(error) or type(error).__name__
    try:
        tags = load(path)
    except Exception:
        tags = None
    out["tags"] = {
        "title": first(tags, "TIT2") if tags is not None else None,
        "artist": first(tags, "TPE1") if tags is not None else None,
        "album": first(tags, "TALB") if tags is not None else None,
    }
    return out


def replace(request):
    target, new, backup = request["target"], request["audio"], request["backup"]
    folder, name = os.path.split(target)
    temp = os.path.join(folder, "~syncthing~" + name + ".tmp")
    try:
        with open(target, "rb") as f:
            old = f.read()
        if hashlib.sha256(old).hexdigest() != request["expectedSha256"]:
            raise Invalid("the file changed since it was measured")
        with open(new, "rb") as f:
            received = f.read()
        old_start, old_end = regions(old)
        new_start, new_end = regions(received)
        audio = received[new_start:new_end]
        written = old[:old_start] + audio + old[old_end:]
        with open(temp, "wb") as f:
            f.write(written)
            f.flush()
            os.fsync(f.fileno())
        with open(temp, "rb") as f:
            check = f.read()
        start, end = regions(check)
        if check[start:end] != audio or check[:start] != old[:old_start] or check[end:] != old[old_end:]:
            raise Invalid("the written file didn't read back")
        frames(check)
        if not os.path.exists(backup):
            os.makedirs(os.path.dirname(backup), exist_ok=True)
            shutil.copy2(target, backup)
        with open(target, "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() != request["expectedSha256"]:
                raise Invalid("the file changed since it was measured")
        os.replace(temp, target)
    except Exception as error:
        if os.path.exists(temp):
            os.remove(temp)
        return {"ok": False, "error": str(error)}
    return {
        "ok": True,
        "sizeBefore": len(old),
        "sizeAfter": len(written),
        "sha256": hashlib.sha256(written).hexdigest(),
    }


def report_row(path):
    try:
        bitrate = MP3(path).info.bitrate // 1000
        return path, bitrate, cutoff(path), None
    except Exception as error:
        return path, None, None, str(error)


def report(root, out):
    paths = sorted(
        os.path.join(folder, name)
        for folder, _, names in os.walk(root)
        for name in names
        if name.lower().endswith(".mp3") and not name.startswith("~syncthing~")
    )
    with ProcessPoolExecutor() as pool:
        measured = list(pool.map(report_row, paths, chunksize=4))
    rows = []
    for path, bitrate, cut, _ in measured:
        rel = os.path.relpath(path, root).replace(os.sep, "/")
        folder, name = rel.rsplit("/", 1) if "/" in rel else ("", rel)
        rows.append((cut or 99999, folder, name, bitrate, "" if cut is None else int(cut), verdict(cut)))
    rows.sort(key=lambda row: (row[0], row[1], row[2]))
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["Folder", "File", "Bitrate kbps", "Cutoff Hz", "Verdict"])
        for row in rows:
            writer.writerow(row[1:])
    return {"files": len(rows), "errors": [path for path, _, _, error in measured if error]}


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "report" and len(sys.argv) == 4:
        result = report(sys.argv[2], sys.argv[3])
    elif command in ("probe", "replace"):
        items = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        if command == "probe":
            with ProcessPoolExecutor() as pool:
                result = list(pool.map(probe, items, chunksize=2))
        else:
            result = replace(items)
    else:
        sys.exit("usage: audio.py probe|replace < items.json, or audio.py report <folder> <csv>")
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
