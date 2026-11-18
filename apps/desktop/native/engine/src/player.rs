//! The song being played: a decoding thread fills a short buffer, and the output pulls frames
//! from it. The position counts frames handed to the output.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::decode::Decoder;
use crate::error::EngineError;

/// How much decoded audio waits ahead of the output, in seconds.
const BUFFER_SECONDS: f64 = 0.5;

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

/// What the decoding thread is asked to do next: start on a new file, move, or both.
#[derive(Default)]
struct Job {
    decoder: Option<Decoder>,
    seek: Option<u64>,
}

struct Prepared {
    decoder: Decoder,
    samples: VecDeque<f32>,
    track: TrackInfo,
    key: String,
    ended: bool,
}

#[derive(Debug, Clone)]
pub struct Transition {
    pub key: String,
    pub at_ms: f64,
}

struct State {
    /// Bumped by every load and seek, so frames decoded for an older request are dropped.
    generation: u64,
    job: Option<Job>,
    /// Decoded interleaved stereo samples, starting at `position`.
    queue: VecDeque<f32>,
    /// Every frame of the current request is in `queue`.
    decoded_all: bool,
    state: PlayState,
    position: u64,
    track: Option<TrackInfo>,
    shutdown: bool,
    next: Option<Prepared>,
    key: Option<String>,
    transitions: Vec<Transition>,
    volume: f32,
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
                generation: 0,
                job: None,
                queue: VecDeque::new(),
                decoded_all: false,
                state: PlayState::Idle,
                position: 0,
                track: None,
                shutdown: false,
                next: None,
                key: None,
                transitions: Vec::new(),
                volume: 1.0,
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
        self.load_entry(path, None)
    }

    pub fn load_entry(&self, path: &Path, key: Option<String>) -> Result<TrackInfo, EngineError> {
        let decoder = Decoder::open(path)?;
        let track = TrackInfo {
            sample_rate: decoder.sample_rate(),
            duration_frames: decoder.duration_frames(),
        };
        let mut state = self.shared.lock();
        state.generation += 1;
        state.job = Some(Job { decoder: Some(decoder), seek: None });
        state.queue.clear();
        state.decoded_all = false;
        state.state = PlayState::Paused;
        state.position = 0;
        state.track = Some(track);
        state.next = None;
        state.key = key;
        state.transitions.clear();
        self.shared.wake.notify_all();
        Ok(track)
    }

    /// Decode a bounded head now, before the callback reaches the current song's end.
    pub fn preload(&self, next: Option<(&Path, String)>) -> Result<(), EngineError> {
        let prepared = if let Some((path, key)) = next {
            let mut decoder = Decoder::open(path)?;
            let track = TrackInfo {
                sample_rate: decoder.sample_rate(),
                duration_frames: decoder.duration_frames(),
            };
            let mut samples = VecDeque::new();
            let mut ended = false;
            while samples.len() < (track.sample_rate as f64 * BUFFER_SECONDS) as usize * 2 {
                match decoder.next_chunk()? {
                    Some(chunk) => samples.extend(chunk),
                    None => {
                        ended = true;
                        break;
                    }
                }
            }
            Some(Prepared { decoder, samples, track, key, ended })
        } else {
            None
        };
        self.shared.lock().next = prepared;
        Ok(())
    }

    pub fn key(&self) -> Option<String> {
        self.shared.lock().key.clone()
    }
    pub fn take_transitions(&self) -> Vec<Transition> {
        std::mem::take(&mut self.shared.lock().transitions)
    }
    pub fn set_volume(&self, volume: f32) {
        self.shared.lock().volume = volume.clamp(0.0, 1.0);
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

    /// Moves to `frame`, keeping play or pause; past the end it stops at the end.
    pub fn seek(&self, frame: u64) -> Result<(), EngineError> {
        let mut state = self.shared.lock();
        let track = state.track.ok_or(EngineError::NothingLoaded)?;
        let frame = track.duration_frames.map_or(frame, |end| frame.min(end));
        state.generation += 1;
        state.job.get_or_insert_with(Job::default).seek = Some(frame);
        state.queue.clear();
        state.decoded_all = false;
        state.position = frame;
        if state.state == PlayState::Ended {
            state.state = PlayState::Paused;
        }
        self.shared.wake.notify_all();
        Ok(())
    }

    pub fn progress(&self) -> Progress {
        let state = self.shared.lock();
        Progress { state: state.state, position_frames: state.position, track: state.track }
    }

    /// Fills `out`, interleaved stereo for a stream at `rate`, with what plays next, or silence.
    /// A song at another rate waits in silence, its position held, for a stream at its own rate:
    /// a next song whose rate differs ends the buffer where the previous one ended.
    pub fn render(&self, out: &mut [f32], rate: u32) {
        let mut state = self.shared.lock();
        let mut written = 0;
        while state.state == PlayState::Playing
            && written < out.len()
            && state.track.is_none_or(|track| track.sample_rate == rate)
        {
            let take = (out.len() - written).min(state.queue.len()) & !1;
            let volume = state.volume;
            for (slot, sample) in out[written..].iter_mut().zip(state.queue.drain(..take)) {
                *slot = sample * volume;
            }
            written += take;
            state.position += (take / 2) as u64;
            if state.queue.is_empty() && state.decoded_all && state.job.is_none() {
                if let Some(next) = state.next.take() {
                    let at_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs_f64()
                        * 1000.0;
                    state.transitions.push(Transition { key: next.key.clone(), at_ms });
                    state.key = Some(next.key);
                    state.track = Some(next.track);
                    state.position = 0;
                    state.queue = next.samples;
                    state.decoded_all = next.ended;
                    state.generation += 1;
                    state.job = Some(Job { decoder: Some(next.decoder), seek: None });
                    self.shared.wake.notify_all();
                } else {
                    state.state = PlayState::Ended;
                }
            }
            if take > 0 {
                self.shared.wake.notify_all();
            }
            if take == 0 {
                break;
            }
        }
        out[written..].fill(0.0);
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

fn decode_loop(shared: &Shared) {
    let mut decoder: Option<Decoder> = None;
    loop {
        let (generation, job) = {
            let mut state = shared.lock();
            loop {
                if state.shutdown {
                    return;
                }
                if state.job.is_some() {
                    break;
                }
                let target =
                    state.track.map_or(0, |t| (t.sample_rate as f64 * BUFFER_SECONDS) as usize * 2);
                if decoder.is_some() && !state.decoded_all && state.queue.len() < target {
                    break;
                }
                state = shared.wake.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            (state.generation, state.job.take())
        };
        if let Some(job) = job {
            if let Some(next) = job.decoder {
                decoder = Some(next);
            }
            if let (Some(frame), Some(current)) = (job.seek, decoder.as_mut())
                && current.seek(frame).is_err()
            {
                finish(shared, generation);
                continue;
            }
        }
        let Some(current) = decoder.as_mut() else { continue };
        // A file that breaks halfway ends there, as if it were shorter.
        let chunk = current.next_chunk().ok().flatten();
        let mut state = shared.lock();
        if state.generation != generation || state.job.is_some() {
            continue;
        }
        match chunk {
            Some(samples) => state.queue.extend(samples),
            None => state.decoded_all = true,
        }
    }
}

fn finish(shared: &Shared, generation: u64) {
    let mut state = shared.lock();
    if state.generation == generation && state.job.is_none() {
        state.decoded_all = true;
    }
}
