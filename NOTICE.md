# Wave licence notice

Copyright (C) 2026 Ygor Perez de Oliveira (LeoPerez8)

Wave is free software: you can redistribute it and/or modify it under the terms of the GNU
General Public License as published by the Free Software Foundation, version 3 only
(SPDX: `GPL-3.0-only`). The licence text is in [LICENSE](LICENSE).

Wave is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See sections 15 and
16 of the licence.

## Additional permission under GNU GPL version 3 section 7

If you modify this Program, or any covered work, by linking or combining it with the Google Play
services libraries for Android (`com.google.android.gms:play-services-*`) or the Google ID library
(`com.google.android.libraries.identity.googleid:googleid`), or a modified version of those
libraries, containing parts covered by the terms of the Android Software Development Kit License,
the licensors of this Program grant you additional permission to convey the resulting work.

The owner grants this permission for the code the owner holds. It doesn't come from the holders
of the third-party GPL code listed below (innertubex, quackjs, the Metrolist and NewPipe ports),
and doesn't extend to their code. You may remove this permission from copies you convey (GPLv3
section 7).

## Not covered by the grant

These paths are in the repository but aren't part of the GPL-3.0-only grant. They hold
third-party content, or material whose origin isn't recorded, and none of it ships in a release:

- `docs/spotify-samples/`: responses captured from Spotify's services.
- `docs/google-translate-samples/`: responses captured from Google Translate.
- `packages/kotlin-shared/src/testFixtures/resources/fixtures/yt/`: captured YouTube Music
  responses.
- `docs/agents/evidence/534/`: screenshots and text dumps of Wave's UI that may show third-party
  album artwork and song names.
- `docs/design/*/reference-*.svg`: comparison icons; `reference-real.svg` appears to be Tabler
  Icons' shuffle icon (MIT).
- `packages/kotlin-shared/src/testFixtures/resources/fixtures/*.{mp3,m4a,ogg,opus,flac,wav,png}`:
  the audio test fixtures and `cover.png`, whose origin isn't recorded.

## Code under other licences

- `packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/recognize/RealFft2048.kt`
  is ported from chfft 0.3.4 and stays under the Mozilla Public License 2.0. MPL-2.0 section 3.3
  lets it be part of this GPL-3.0-only work.
- Files ported or derived from Metrolist, NewPipe, innertubex, ytmusicapi, shazamio-core and
  SongRec carry a header naming the source, its licence and copyright holder, and Wave's changes.
  The GPL-3.0 and GPL-3.0-or-later code among them is conveyed under GPL version 3; the MIT code
  keeps its notice.

## Third-party components and notices

Each library and asset a release ships, with its licence and the notice it carries, is in the
rights inventory: [docs/licensing/rights-inventory.md](docs/licensing/rights-inventory.md), with
the data in `docs/licensing/components.json`, `docs/licensing/npm-packages.json` and
`docs/licensing/android-release-closure.json`. To list the notices a release carries:

```bash
node scripts/ci/rights-inventory.ts notices
```

Each release's Corresponding Source, including the third-party GPL libraries at their exact
revisions, is described in [docs/release-source.md](docs/release-source.md).

### Desktop audio codecs

`symphonia-codec-alac` 0.6.1 is copyright (c) 2019-2026 The Project Symphonia Developers.
Its source files are available under the Mozilla Public License 2.0.
[Source and licence](https://docs.rs/crate/symphonia-codec-alac/0.6.1/source/).

`oxideav-aac` 0.1.7 and `oxideav-core` 0.1.43 carry the following notice.

```text
MIT License

Copyright (c) 2026 Karpelès Lab Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
