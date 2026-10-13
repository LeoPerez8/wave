# Soulseek acquisition on Android

Wave uses its own Kotlin TCP client inside `wave-native`. It needs no daemon,
PC or downloader app. A free account connects in Wave; subsequent searches
reuse it. Android Keystore protects the credentials with AES-GCM in the app's
no-backup directory. Credentials never appear in session responses or logs.
Soulseek's login protocol itself uses plain TCP, as existing clients do.

The protocol reference is [Nicotine+'s documentation](https://nicotine-plus.org/doc/SLSKPROTOCOL.html),
reviewed on 2026-10-13. [Seeker's Android client and embedded Soulseek.NET](https://github.com/jackBonadies/SeekerAndroid)
were used as interoperability references, not as dependencies or copied client
code. Wave identifies its experimental client with protocol major version 177.

`WaveSoulseek` provides session, connect, disconnect, search, downloadAudio and
cancelDownload. `AndroidSoulseek.get(context)` owns the process-wide client for
native background callers. Search yields bounded peer reports; Core selects
the recording. The transport supports direct and indirect peer connections,
QueueUpload, queue position reports, TransferRequest acceptance, direct and
indirect file connections, and explicit cancellation. A peer that disconnects,
refuses the file or exceeds the queue deadline fails that attempt; the download
owner can try another selected candidate. Retries start from zero because the
protocol cannot prove that previously received chunks belong to the same file.

Wave downloads original MP3 320 files and preserves their audio bytes. It has
no lossless-to-MP3 encoder. Every received MPEG frame must be MPEG-1 Layer III
at 320 kbps; the measured frame duration must match the intended recording.
The exact transfer byte count and complete frame boundaries are checked too.
Android MediaCodec then decodes the file before publication and checks the
decoded duration. Received ID3 title, artist and album remain available for
matching before trusted tags replace them. The validation proves the received
codec and bitrate; it cannot prove whether a peer previously transcoded the
recording. Its provenance is reported as unknown.

The existing download tag writer, hidden part file, atomic publication and
single-file scanner remain the Library import path. Downloading never calls a
Library upload resolver: Wave advertises zero shared files, returns empty
browse results, and refuses upload requests and unsolicited incoming files.

## Validation record

The native public API is tested against real localhost TCP fixtures, including
authentication, indirect search, a queue followed by an indirect file transfer,
a disconnected peer, empty sharing and refused upload/push requests. The audio
fixture is a generated 1.5-second 440 Hz tone encoded with libmp3lame at 320 kbps;
lower bitrate, truncated and wrong-duration files must fail. The credentials
store is tested with authenticated AES-GCM encryption and tamper rejection.

These tests are reproducible with the module's Kotlin JVM tests. They are
protocol fixtures, not measurements of the public network. No authenticated
phone download or representative recording benchmark has been run yet; those
need the owner's account and recording set. Availability, queue wait times and
matching coverage remain unmeasured. Android decoding must also be exercised
on the target phone before treating the on-device prototype as validated.
