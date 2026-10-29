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
