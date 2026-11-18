//! The song being played: a decoding thread fills a short buffer per voice, and the output pulls
//! frames from it. The position counts frames of the current song handed to the output.
//!
//! A voice is one song's decoded audio, with the gain Normalize Volume gave it as it started, so
//! the gain switches on the song's first frame. With crossfade, the song that ends on its own
//! keeps a voice of its own while it fades out under the next one (docs/spec.md, story 22a).

use std::collections::VecDeque;
use std::f64::consts::FRAC_PI_2;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::decode::Decoder;
use crate::error::EngineError;
use crate::stream::Origin;

/// How much decoded audio waits ahead of the output, in seconds.
const BUFFER_SECONDS: f64 = 0.5;

/// A next song that's ready with less than this left of the current one follows gaplessly
/// (Core's `MIN_LATE_CROSSFADE_MS`).
const MIN_LATE_CROSSFADE_MS: f64 = 1000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayState {
    /// Nothing loaded yet.
    Idle,
    Paused,
    Playing,
    /// The song played to its end.
    Ended,
}

impl PlayState {
    pub fn as_str(self) -> &'static str {
        match self {
            PlayState::Idle => "idle",
            PlayState::Paused => "paused",
            PlayState::Playing => "playing",
            PlayState::Ended => "ended",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrackInfo {
    pub sample_rate: u32,
    pub duration_frames: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub state: PlayState,
    pub position_frames: u64,
    pub track: Option<TrackInfo>,
}

/// The song lined up after the current one.
#[derive(Debug, Clone)]
pub struct Next<'a> {
    pub path: &'a Path,
    /// The queue entry it plays.
    pub key: String,
    /// Its Normalize Volume gain in dB; none plays it as it is.
    pub gain_db: Option<f64>,
    /// Whether ending on its own into it may crossfade: not with repeat one, nor an end-of-song
    /// sleep timer.
    pub fade: bool,
}

impl<'a> Next<'a> {
    /// The song at `path`, for entry `key`, at 0 dB, crossfading when the setting is on.
    pub fn new(path: &'a Path, key: impl Into<String>) -> Next<'a> {
        Next { path, key: key.into(), gain_db: None, fade: true }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionKind {
    /// The current song ended and the next one followed without a gap.
    Gapless,
    /// The next song started fading in under the current one, which fades out.
    Crossfade,
    /// The song fading out went silent, or a seek cut it off.
    FadeEnded,
}

impl TransitionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TransitionKind::Gapless => "gapless",
            TransitionKind::Crossfade => "crossfade",
            TransitionKind::FadeEnded => "fadeEnded",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Transition {
    /// The entry moved to; for `FadeEnded`, the one that faded out.
    pub key: String,
    pub at_ms: f64,
    pub kind: TransitionKind,
}

/// One song's decoded audio on its way to the output.
struct Voice {
    /// Names the voice to the decoding thread, which may hold its decoder for a moment.
    id: u64,
    key: Option<String>,
    track: TrackInfo,
    /// Decoded interleaved stereo samples, starting at the voice's position.
    queue: VecDeque<f32>,
    /// Every frame up to the song's end is in `queue`.
    decoded_all: bool,
    /// `None` while the decoding thread decodes with it.
    decoder: Option<Decoder>,
    /// A seek the decoding thread hasn't made yet.
    seek: Option<u64>,
    /// Bumped by every seek, so frames decoded before it are dropped.
    epoch: u64,
    /// Normalize Volume's gain, settled when the song was loaded or lined up.
    gain_db: Option<f64>,
}

impl Voice {
    fn new(id: u64, key: Option<String>, decoder: Decoder, gain_db: Option<f64>) -> Voice {
        Voice {
            id,
            key,
            track: TrackInfo {
                sample_rate: decoder.sample_rate(),
                duration_frames: decoder.duration_frames(),
            },
            queue: VecDeque::new(),
            decoded_all: false,
            decoder: Some(decoder),
            seek: None,
            epoch: 0,
            gain_db,
        }
    }

    fn wants_decoding(&self) -> bool {
        self.decoder.is_some()
            && (self.seek.is_some()
                || (!self.decoded_all && self.queue.len() < buffer_samples(self.track)))
    }

    fn gain(&self, normalize: bool) -> f32 {
        match self.gain_db {
            Some(db) if normalize && db.is_finite() => 10f64.powf(db / 20.0) as f32,
            _ => 1.0,
        }
    }
}

fn buffer_samples(track: TrackInfo) -> usize {
    (track.sample_rate as f64 * BUFFER_SECONDS) as usize * 2
}

/// The song fading out under the current one.
struct Fade {
    voice: Voice,
    /// The overlap's length, and how much of it has played, in frames.
    overlap: u64,
    done: u64,
}

struct Upcoming {
    voice: Voice,
    fade: bool,
}

struct State {
    current: Option<Voice>,
    fading: Option<Fade>,
    next: Option<Upcoming>,
    state: PlayState,
    position: u64,
    shutdown: bool,
    transitions: Vec<Transition>,
    volume: f32,
    /// Crossfade's overlap (Settings › Playback); 0 keeps every move gapless.
    crossfade_ms: f64,
    /// Normalize Volume's switch: off plays every song as it is, the playing one included.
    normalize: bool,
    last_id: u64,
}

impl State {
    fn new_id(&mut self) -> u64 {
        self.last_id += 1;
        self.last_id
    }

    fn voice_mut(&mut self, id: u64) -> Option<&mut Voice> {
        if let Some(voice) = self.current.as_mut().filter(|v| v.id == id) {
            return Some(voice);
        }
        self.fading.as_mut().map(|f| &mut f.voice).filter(|v| v.id == id)
    }

    fn report(&mut self, key: String, kind: TransitionKind) {
        let at_ms =
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000.0;
        self.transitions.push(Transition { key, at_ms, kind });
    }

    fn end_fade(&mut self) {
        if let Some(fade) = self.fading.take() {
            self.report(fade.voice.key.unwrap_or_default(), TransitionKind::FadeEnded);
        }
    }

    /// The overlap, in frames, the current song would fade into the next one for, and where in
    /// the current song it starts; `None` when the move is gapless.
    fn planned_fade(&self) -> Option<(u64, u64)> {
        let current = self.current.as_ref()?;
        let next = self.next.as_ref().filter(|next| next.fade)?;
        if self.fading.is_some()
            || self.crossfade_ms <= 0.0
            || next.voice.track.sample_rate != current.track.sample_rate
        {
            return None;
        }
        let duration = current.track.duration_frames?;
        let rate = current.track.sample_rate as f64;
        let setting = (self.crossfade_ms * rate / 1000.0).round() as u64;
        // At most half the song (Core's `songOverlap`).
        let overlap = setting.min(duration / 2);
        if overlap == 0 {
            return None;
        }
        let start = duration - overlap;
        if self.position <= start {
            return Some((overlap, start));
        }
        // Lined up late, or a seek into the overlap: Core's `lateCrossfadeOverlap`.
        let left = duration.saturating_sub(self.position);
        if (left as f64) * 1000.0 / rate < MIN_LATE_CROSSFADE_MS {
            return None;
        }
        Some((left, self.position))
    }

    /// The next song starts fading in, current from its first frame, and the current one fades
    /// out over `overlap` frames.
    fn start_fade(&mut self, overlap: u64) {
        let (Some(outgoing), Some(next)) = (self.current.take(), self.next.take()) else {
            return;
        };
        self.report(next.voice.key.clone().unwrap_or_default(), TransitionKind::Crossfade);
        self.current = Some(next.voice);
        self.position = 0;
        self.fading = Some(Fade { voice: outgoing, overlap, done: 0 });
    }

    /// The current song played to its end: the next one follows without a gap, or play ends.
    fn finish_song(&mut self) {
        match self.next.take() {
            Some(next) => {
                self.report(next.voice.key.clone().unwrap_or_default(), TransitionKind::Gapless);
                self.current = Some(next.voice);
                self.position = 0;
            }
            None => {
                self.state = PlayState::Ended;
                self.end_fade();
            }
        }
    }
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub struct Player {
    shared: Arc<Shared>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Player {
    pub fn new() -> Player {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                current: None,
                fading: None,
                next: None,
                state: PlayState::Idle,
                position: 0,
                shutdown: false,
                transitions: Vec::new(),
                volume: 1.0,
                crossfade_ms: 0.0,
                normalize: true,
                last_id: 0,
            }),
            wake: Condvar::new(),
        });
        let worker_shared = Arc::clone(&shared);
        let worker = thread::Builder::new()
            .name("wave-decode".into())
            .spawn(move || decode_loop(&worker_shared))
            .expect("starts the decoding thread");
        Player { shared, worker: Some(worker) }
    }

    /// Opens `path` paused at its start, in place of any song loaded before.
    pub fn load(&self, path: &Path) -> Result<TrackInfo, EngineError> {
        self.load_entry(path, None, None)
    }

    /// Opens `path` for entry `key`, at `gain_db`, paused at its start. A song fading out stops.
    pub fn load_entry(
        &self,
        path: &Path,
        key: Option<String>,
        gain_db: Option<f64>,
    ) -> Result<TrackInfo, EngineError> {
        self.load_origin(&Origin::File(path.to_path_buf()), key, gain_db)
    }

    /// Opens a song from a file or a stream for entry `key`, at `gain_db`, paused at its start.
    pub fn load_origin(
        &self,
        origin: &Origin,
        key: Option<String>,
        gain_db: Option<f64>,
    ) -> Result<TrackInfo, EngineError> {
        let decoder = Decoder::open_origin(origin)?;
        let mut state = self.shared.lock();
        let id = state.new_id();
        let voice = Voice::new(id, key, decoder, gain_db);
        let track = voice.track;
        state.current = Some(voice);
        state.fading = None;
        state.next = None;
        state.state = PlayState::Paused;
        state.position = 0;
        state.transitions.clear();
        self.shared.wake.notify_all();
        Ok(track)
    }

    /// Lines up the song after the current one, its head decoded now so the move to it never
    /// waits on the file; `None` lines up nothing. A song already fading out goes on.
    pub fn preload(&self, next: Option<Next<'_>>) -> Result<(), EngineError> {
        self.preload_origin(next.map(|next| (Origin::File(next.path.to_path_buf()), next)))
    }

    /// As `preload`, the song read from `origin` (a file or a stream) rather than `next.path`.
    pub fn preload_origin(&self, next: Option<(Origin, Next<'_>)>) -> Result<(), EngineError> {
        let prepared = match next {
            Some((origin, next)) => {
                let mut voice =
                    Voice::new(0, Some(next.key), Decoder::open_origin(&origin)?, next.gain_db);
                let decoder = voice.decoder.as_mut().expect("a new voice holds its decoder");
                while voice.queue.len() < buffer_samples(voice.track) {
                    match decoder.next_chunk()? {
                        Some(chunk) => voice.queue.extend(chunk),
                        None => {
                            voice.decoded_all = true;
                            break;
                        }
                    }
                }
                Some(Upcoming { voice, fade: next.fade })
            }
            None => None,
        };
        let mut state = self.shared.lock();
        state.next = prepared.map(|mut upcoming| {
            upcoming.voice.id = state.new_id();
            upcoming
        });
        Ok(())
    }

    pub fn key(&self) -> Option<String> {
        self.shared.lock().current.as_ref().and_then(|voice| voice.key.clone())
    }

    /// The moves to the next song, and the fades that ended, since the last call.
    pub fn take_transitions(&self) -> Vec<Transition> {
        std::mem::take(&mut self.shared.lock().transitions)
    }

    pub fn set_volume(&self, volume: f32) {
        self.shared.lock().volume = volume.clamp(0.0, 1.0);
    }

    /// Crossfade's overlap in ms (0 to 15,000); read at each move, so it applies from the next.
    pub fn set_crossfade(&self, ms: f64) {
        self.shared.lock().crossfade_ms =
            if ms.is_finite() { ms.clamp(0.0, 15_000.0) } else { 0.0 };
    }

    /// Normalize Volume's switch; applies at once, to the playing song too.
    pub fn set_normalize(&self, on: bool) {
        self.shared.lock().normalize = on;
    }

    pub fn play(&self) -> Result<(), EngineError> {
        let mut state = self.shared.lock();
        match state.state {
            PlayState::Idle => return Err(EngineError::NothingLoaded),
            PlayState::Ended => {
                drop(state);
                self.seek(0)?;
                state = self.shared.lock();
            }
            _ => {}
        }
        state.state = PlayState::Playing;
        Ok(())
    }

    /// Pauses; a song fading out pauses with the current one.
    pub fn pause(&self) -> Result<(), EngineError> {
        let mut state = self.shared.lock();
        match state.state {
            PlayState::Idle => Err(EngineError::NothingLoaded),
            PlayState::Playing => {
                state.state = PlayState::Paused;
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// Moves to `frame`, keeping play or pause; past the end it stops at the end. A song fading
    /// out stops.
    pub fn seek(&self, frame: u64) -> Result<(), EngineError> {
        let mut state = self.shared.lock();
        let voice = state.current.as_mut().ok_or(EngineError::NothingLoaded)?;
        let frame = voice.track.duration_frames.map_or(frame, |end| frame.min(end));
        voice.epoch += 1;
        voice.seek = Some(frame);
        voice.queue.clear();
        voice.decoded_all = false;
        state.position = frame;
        state.end_fade();
        if state.state == PlayState::Ended {
            state.state = PlayState::Paused;
        }
        self.shared.wake.notify_all();
        Ok(())
    }

    pub fn progress(&self) -> Progress {
        let state = self.shared.lock();
        Progress {
            state: state.state,
            position_frames: state.position,
            track: state.current.as_ref().map(|voice| voice.track),
        }
    }

    /// Fills `out`, interleaved stereo for a stream at `rate`, with what plays next, or silence,
    /// and says how many frames played. A song at another rate waits in silence, its position
    /// held, for a stream at its own rate: a next song whose rate differs ends the buffer where
    /// the previous one ended.
    pub fn render(&self, out: &mut [f32], rate: u32) -> usize {
        let mut state = self.shared.lock();
        let state = &mut *state;
        let mut written = 0;
        while state.state == PlayState::Playing && written < out.len() {
            let Some(current) = state.current.as_ref() else { break };
            if current.track.sample_rate != rate {
                break;
            }
            let mut until_fade = u64::MAX;
            if let Some((overlap, start)) = state.planned_fade() {
                if state.position >= start {
                    state.start_fade(overlap);
                    continue;
                }
                until_fade = start - state.position;
            }
            let current = state.current.as_mut().expect("checked above");
            let mut frames = ((out.len() - written) / 2).min(current.queue.len() / 2);
            frames = frames.min(until_fade.min(usize::MAX as u64) as usize);
            if let Some(fade) = state.fading.as_ref() {
                frames = frames.min((fade.overlap - fade.done) as usize);
                if !fade.voice.decoded_all {
                    frames = frames.min(fade.voice.queue.len() / 2);
                }
            }
            let volume = state.volume;
            let gain = current.gain(state.normalize) * volume;
            let slots = &mut out[written..written + frames * 2];
            match state.fading.as_mut() {
                None => {
                    for (slot, sample) in slots.iter_mut().zip(current.queue.drain(..frames * 2)) {
                        *slot = sample * gain;
                    }
                }
                Some(fade) => {
                    let out_gain = fade.voice.gain(state.normalize) * volume;
                    let overlap = fade.overlap as f64;
                    let mut incoming = current.queue.drain(..frames * 2);
                    for (n, frame) in slots.as_chunks_mut::<2>().0.iter_mut().enumerate() {
                        let at = (fade.done + n as u64) as f64 / overlap;
                        let fade_in = (at * FRAC_PI_2).sin() as f32;
                        let fade_out = ((1.0 - at) * FRAC_PI_2).sin() as f32;
                        for slot in frame {
                            let new = incoming.next().unwrap_or(0.0);
                            let old = fade.voice.queue.pop_front().unwrap_or(0.0);
                            *slot = new * gain * fade_in + old * out_gain * fade_out;
                        }
                    }
                    drop(incoming);
                    fade.done += frames as u64;
                    if fade.done >= fade.overlap
                        || (fade.voice.decoded_all && fade.voice.queue.is_empty())
                    {
                        state.end_fade();
                    }
                }
            }
            written += frames * 2;
            state.position += frames as u64;
            let current = state.current.as_ref().expect("still there");
            let ended = current.queue.is_empty() && current.decoded_all && current.seek.is_none();
            if ended {
                state.finish_song();
            }
            if frames > 0 {
                self.shared.wake.notify_all();
            } else if !ended {
                break;
            }
        }
        out[written..].fill(0.0);
        written / 2
    }
}

impl Default for Player {
    fn default() -> Player {
        Player::new()
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.shared.lock().shutdown = true;
        self.shared.wake.notify_all();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Keeps every voice's buffer full: the current song's first, then the one fading out. It takes
/// a voice's decoder while it decodes, and gives it back with the chunk.
fn decode_loop(shared: &Shared) {
    loop {
        let (id, epoch, mut decoder, seek) = {
            let mut state = shared.lock();
            loop {
                if state.shutdown {
                    return;
                }
                let current = state.current.as_mut().filter(|v| v.wants_decoding());
                let voice = match current {
                    Some(voice) => Some(voice),
                    None => {
                        state.fading.as_mut().map(|f| &mut f.voice).filter(|v| v.wants_decoding())
                    }
                };
                if let Some(voice) = voice {
                    let decoder = voice.decoder.take().expect("wants_decoding checks it");
                    break (voice.id, voice.epoch, decoder, voice.seek.take());
                }
                state = shared.wake.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        };
        let decoded = match seek {
            Some(frame) => decoder.seek(frame),
            None => Ok(()),
        }
        .and_then(|()| decoder.next_chunk());
        let mut state = shared.lock();
        let Some(voice) = state.voice_mut(id) else { continue };
        voice.decoder = Some(decoder);
        if voice.epoch != epoch {
            continue;
        }
        // A file that breaks halfway ends there, as if it were shorter.
        match decoded {
            Ok(Some(samples)) => voice.queue.extend(samples),
            Ok(None) | Err(_) => voice.decoded_all = true,
        }
        shared.wake.notify_all();
    }
}
