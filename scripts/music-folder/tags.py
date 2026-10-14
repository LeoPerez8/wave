"""Tag I/O for organize.ts (needs mutagen: `pip install mutagen`).

  python -I tags.py read          stdin: JSON list of paths
  python -I tags.py write-genre   stdin: JSON list of {"path", "genre"}

Both print JSON on stdout (ASCII only, so the Windows console code page
doesn't matter). Fields are read the way Wave's scanner (jaudiotagger) reads
them: the ID3v2 tag, else the ID3v1 tag when the file has no ID3v2 tag.

write-genre adds a genre only to a file that has none. It writes a copy named
`~syncthing~<name>.tmp` beside the file (Syncthing ignores that prefix),
checks that the audio between the tags is byte for byte the same and the
genre reads back, then replaces the file with it.
"""

import hashlib
import json
import os
import shutil
import sys

from mutagen.id3 import ID3, TCON, ID3NoHeaderError
from mutagen.mp3 import MP3

COMPILATION_KEYS = ("TCMP", "COMPILATION")


def texts(tags, frame_id):
    values = []
    for frame in tags.getall(frame_id):
        for value in getattr(frame, "text", []):
            value = str(value).replace("\x00", "").strip()
            if value:
                values.append(value)
    return values


def first(tags, frame_id):
    values = texts(tags, frame_id)
    return values[0] if values else None


def truthy(value):
    return value is not None and value.strip().lower() in ("1", "true", "yes")


def load(path):
    """The ID3v2 tag, else the ID3v1 one as frames; None without either."""
    try:
        return ID3(path, load_v1=False)
    except ID3NoHeaderError:
        try:
            return ID3(path, load_v1=True)
        except ID3NoHeaderError:
            return None


def read_one(path):
    out = {"path": path, "sizeBytes": os.path.getsize(path)}
    try:
        out["durationMs"] = round(MP3(path).info.length * 1000)
    except Exception as error:  # an unreadable stream still gets a place
        out["durationMs"] = None
        out["audioError"] = str(error)
    try:
        tags = load(path)
    except Exception as error:
        out["error"] = str(error)
        return out
    if tags is None:
        out["tagVersion"] = None
        return out
    out["tagVersion"] = ".".join(str(n) for n in tags.version)
    out["title"] = first(tags, "TIT2")
    out["artists"] = texts(tags, "TPE1")
    out["artist"] = out["artists"][0] if out["artists"] else None
    out["album"] = first(tags, "TALB")
    out["albumArtists"] = texts(tags, "TPE2")
    out["albumArtist"] = out["albumArtists"][0] if out["albumArtists"] else None
    out["genre"] = first(tags, "TCON")
    out["year"] = first(tags, "TDRC") or first(tags, "TYER")
    out["trackNumber"] = first(tags, "TRCK")
    out["discNumber"] = first(tags, "TPOS")
    compilation = truthy(first(tags, "TCMP"))
    for frame in tags.getall("TXXX"):
        if frame.desc.upper() in COMPILATION_KEYS and truthy(str(frame.text[0]) if frame.text else None):
            compilation = True
    out["compilation"] = compilation
    return out


def audio_digest(path):
    """SHA-256 of the bytes between a leading ID3v2 tag and a trailing ID3v1 tag."""
    with open(path, "rb") as f:
        data = f.read()
    start = 0
    if data[:3] == b"ID3" and len(data) >= 10:
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        start = 10 + size + (10 if data[5] & 0x10 else 0)
    end = len(data) - 128 if data[-128:-125] == b"TAG" else len(data)
    return hashlib.sha256(data[start:end]).hexdigest()


def write_genre(path, genre):
    before = os.path.getsize(path)
    tags = load(path)
    if tags is not None and texts(tags, "TCON"):
        return {"path": path, "ok": False, "error": "already has a genre", "sizeBefore": before}
    folder, name = os.path.split(path)
    temp = os.path.join(folder, "~syncthing~" + name + ".tmp")
    shutil.copy2(path, temp)
    try:
        try:
            had_v2 = True
            original = ID3(temp, load_v1=False)
            version = 4 if original.version[1] == 4 else 3
        except ID3NoHeaderError:
            had_v2 = False
            version = 3
        if had_v2:
            tags = ID3(temp, load_v1=False, v2_version=version)
        else:
            try:
                tags = ID3(temp, load_v1=True, v2_version=3)  # carries ID3v1 fields over
            except ID3NoHeaderError:
                tags = ID3()
        tags.add(TCON(encoding=3, text=[genre]))
        tags.save(temp, v1=1, v2_version=version, v23_sep=None)
        if audio_digest(temp) != audio_digest(path):
            raise RuntimeError("the audio changed")
        if first(load(temp), "TCON") != genre:
            raise RuntimeError("the genre didn't read back")
        os.replace(temp, path)
    except Exception as error:
        if os.path.exists(temp):
            os.remove(temp)
        return {"path": path, "ok": False, "error": str(error), "sizeBefore": before}
    return {"path": path, "ok": True, "sizeBefore": before, "sizeAfter": os.path.getsize(path)}


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    items = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if command == "read":
        result = [read_one(path) for path in items]
    elif command == "write-genre":
        result = [write_genre(item["path"], item["genre"]) for item in items]
    else:
        sys.exit("usage: tags.py read|write-genre < items.json")
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
