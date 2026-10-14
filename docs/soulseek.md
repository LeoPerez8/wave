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

`WaveSoulseek` provides session, connect, disconnect, search and the download
journal. `AndroidSoulseek.get(context)` owns the process-wide client for
native background callers. Search yields bounded peer reports; Core selects
the recording. The transport supports direct and indirect peer connections,
QueueUpload, queue position reports, TransferRequest acceptance, direct and
indirect file connections, and explicit cancellation. The server sends peer
IPs with their bytes reversed, as Nicotine+ and Soulseek.NET read them. A
popular search brings thousands of connection requests in seconds, so search
connections and a download's peer and file connections run on separate thread
slots. A peer that disconnects,
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
single-file scanner remain the Library import path. Once a download is
imported, Find Lyrics and Genre runs on it and writes the lyrics or genre the
file still lacks (Core's `missingTags`); it never replaces ones it has. Downloading never calls a
Library upload resolver: Wave advertises zero shared files, returns empty
browse results, and refuses upload requests and unsolicited incoming files.

## Background execution

Soulseek is the source a download uses once the owner connects a free account
in Settings; without one, downloads come from YouTube Music while YT Music is
on (Core's `downloadSource`, docs/spec.md "Downloads"). With YT Music on, a
Soulseek job that Soulseek can't deliver (no 320 copy or the peers ran out, a
rejected account, a server that can't be connected to while the network
works, or its 20 minutes used up) carries on from YouTube Music in the same
job, with time of its own (Core's `downloadFallback`); offline, storage and
folder failures don't. A server connection that drops (a network handover, a
reconnect from Settings) counts as offline and is connected again. Either way each
Download tap queues a job with no further choices. This document covers the
Soulseek side. `DurableDownloads` (package `download`) is the queue's owner, not
JavaScript: it persists every job (request, source, chosen recording, candidates,
current peer, attempt counts, absolute deadlines and the `mp3-320` policy) in
`noBackupFilesDir/soulseek-download-jobs-v1`, rewritten atomically after each
step. `YtDownloadService`, a `dataSync` foreground service, runs it one job at
a time with a partial wake lock and a Wi-Fi lock, so it continues with the
screen off and beside playback. Its notification shows the current job's
waiting, downloading or saving state and offers Cancel.

Decisions that need the Library or Core are leased to JavaScript with a
token, a generation and a 45-second lease: prepare (search, Core's recording
match, tags and destination), confirm (received tags), publish (the current
folders and exclusions, versioned so a stale answer is refused) and import
(the LibraryStore upsert). After process recreation the sticky service
restarts, starts the headless JS runtime and replays the journal; an
unanswered lease simply expires and is offered again. A transfer that was cut
off restarts from zero with the same peer and its original deadlines.

Bounds: searching retries a dropped connection three times; a job makes at
most six transfer attempts over at most three peers; a peer may keep Wave in
its queue for 2 minutes, has 3 minutes to start sending and may go quiet for
1 minute; a job has 20 minutes after leaving the queue. The client has no time
limit of its own: it asks the journal whether the transfer is still wanted.
Exhausted peers end in
a short failure with Retry (or, with YT Music on, the fallback to YouTube
Music), never a different recording. Every failure,
cancellation or recovery deletes the hidden part files and never replaces an
existing Library file; publication renames a verified, tagged file into a free
name, and import is an idempotent upsert by path, so repeated completion
cannot create duplicate Tracks. If Android refuses to restart the service in
the background, the journal waits for Wave's next launch.

Several result ids of the same recording share one job. A row's Cancel
Download removes only that song from it, and the download stops once no song
that asked for it remains; the notification's Cancel stops it for all of them.
A published file the Library couldn't import shows as a failure: Retry imports
it again, and Cancel forgets the row and leaves the file in the folder.

The search query is Core's `soulseekQuery`: the main artist and the title
without guests, edition notes, punctuation or words with apostrophes, because
peers only return files whose path contains every query word.

## Validation record

The native public API is tested against real localhost TCP fixtures, including
authentication, indirect search, a queue followed by an indirect file transfer,
a disconnected peer, empty sharing and refused upload/push requests. The audio
fixture is a generated 1.5-second 440 Hz tone encoded with libmp3lame at 320 kbps;
lower bitrate, truncated and wrong-duration files must fail. The credentials
store is tested with authenticated AES-GCM encryption and tamper rejection.

`DurableDownloadsTest` covers the journal through its public API: recreation
mid-transfer and mid-decision, persisted queue position and deadlines,
bounded failover, stalled and queued peers, offline retries, cancellation
cleanup, duplicate completion, storage, account and unwritable-folder failures,
and queue order.

These tests are reproducible with the module's Kotlin JVM tests. They are
protocol fixtures, not measurements of the public network. No authenticated
phone download or representative recording benchmark has been run yet; those
need the owner's account and recording set. Availability, queue wait times and
matching coverage remain unmeasured. Android decoding must also be exercised
on the target phone before treating the on-device prototype as validated.
Screen-off acquisition, playback during a download and recovery after the
process is killed have not yet been checked on the phone.
