# Shazam fixtures

Used by the tests in `src/test/java/expo/modules/wavenative/recognize`.

## Signatures

`<name>.pcm` is 4 s of 16 kHz mono audio, signed 16-bit little-endian. `<name>.uri` is
the signature shazamio-core 2.0.0 (the PyPI wheel) gives for it, as the data URI Shazam
is sent. `SignatureGeneratorTest` checks the Kotlin port gives the same bytes.

- `chord-song`: notes in all four bands with a little noise.
- `pause`: notes, 2.6 s of silence, notes, so every band's peaks jump more than 255 FFT
  passes.

They were made with, from the repository root:

```sh
python -m venv venv && venv/bin/pip install shazamio-core==2.0.0 numpy
venv/bin/python apps/mobile/modules/wave-native/android/src/test/fixtures-src/shazam/make_fixtures.py
```

It needs git and a Rust toolchain too. `make_fixtures.py` says how it works: the wheel
always resamples, even 16 kHz to 16 kHz, so the samples it fingerprints come from a build
of shazamio-core's own sources (`signature-tool`), and the script stops unless that
build and the wheel give the same signature for the same WAV file.

## Answers

`answers/` holds what Shazam's discovery endpoint answered, saved on 2026-10-28 with
shazamio 0.9.0 (`Shazam(language, endpoint_country).recognize(path)`), indented for reading:

- `match.json`: `en-US`/`US`, for `examples/data/Gloria.ogg` from the
  [ShazamIO](https://github.com/shazamio/ShazamIO) repository.
- `match-pt-BR.json`: the same in `pt-BR`/`BR`, where the SONG section's headings are
  translated ("Álbum", "Selo", "Lançado").
- `no-match.json`: `en-US`/`US`, for 4 s of a 440 Hz tone.
- `match-without-album.json`: `match.json` with `track.isrc`, `track.albumadamid`,
  `track.images.coverarthq` and the SONG section's "Album" entry removed by hand, as
  Shazam answers for a song with no album.
