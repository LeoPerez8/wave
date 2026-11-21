//! The engine the app drives: one player on the default output device, or the one chosen.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;

use crate::error::EngineError;
use crate::loudness::{Measurement, measure};
use crate::output::{Output, OutputDevice};
use crate::player::{Next, PlayState, Player, TrackInfo, Transition};
use crate::stream::{Origin, Streams};

/// A path the engine reads as a YT Music song: `yt:` and its video id.
const STREAMED: &str = "yt:";

#[derive(Debug, Clone, PartialEq)]
pub struct Status {
    pub state: PlayState,
    pub position_ms: f64,
    /// The song's length, when the file says.
    pub duration_ms: Option<f64>,
    /// The output device by its system name; `None` while the song keeps time without one.
    pub device: Option<String>,
    pub key: Option<String>,
}

pub struct Engine {
    player: Arc<Player>,
    output: Output,
    streams: Option<Arc<Streams>>,
    measuring: Measuring,
}

impl Engine {
    /// An engine on the system's default output device.
    pub fn new() -> Engine {
        Engine::start(false)
    }

    /// An engine that keeps time without opening a device, for tests and machines without one.
    pub fn silent() -> Engine {
        Engine::start(true)
    }

    fn start(silent: bool) -> Engine {
        Engine::with_streams(silent, None)
    }

    /// An engine that also plays YT Music songs, `yt:<videoId>`, through `streams`.
    pub fn with_streams(silent: bool, streams: Option<Arc<Streams>>) -> Engine {
        let player = Arc::new(Player::new());
        let output = Output::start(Arc::clone(&player), silent);
        Engine { player, output, streams, measuring: Measuring::start() }
    }

    pub fn streams(&self) -> Option<&Arc<Streams>> {
        self.streams.as_ref()
    }

    /// Where `path` is read from: the file, or a streamed song's cache or download.
    fn origin(&self, path: &Path) -> Result<Origin, EngineError> {
        let Some(video_id) = path.to_str().and_then(|p| p.strip_prefix(STREAMED)) else {
            return Ok(Origin::File(path.to_path_buf()));
        };
        self.streams
            .as_ref()
            .and_then(|streams| streams.open(video_id))
            .ok_or_else(|| EngineError::NotFound("the song isn't fetched".into()))
    }

    pub fn load(&self, path: &Path) -> Result<Status, EngineError> {
        self.load_entry(path, None, None)
    }

    pub fn play(&self) -> Result<(), EngineError> {
        self.player.play()
    }

    /// Opens `path` for queue entry `key`, paused, at Normalize Volume's `gain_db`.
    pub fn load_entry(
        &self,
        path: &Path,
        key: Option<String>,
        gain_db: Option<f64>,
    ) -> Result<Status, EngineError> {
        self.player.load_origin(&self.origin(path)?, key, gain_db)?;
        Ok(self.status())
    }

    pub fn preload(&self, next: Option<Next<'_>>) -> Result<(), EngineError> {
        let next = match next {
            Some(next) => Some((self.origin(next.path)?, next)),
            None => None,
        };
        self.player.preload_origin(next)
    }

    pub fn take_transitions(&self) -> Vec<Transition> {
        self.player.take_transitions()
    }

    pub fn set_volume(&self, volume: f32) {
        self.player.set_volume(volume);
    }

    /// Crossfade's overlap in seconds (Settings › Playback); from the next song on.
    pub fn set_crossfade(&self, seconds: f64) {
        self.player.set_crossfade(seconds * 1000.0);
    }

    /// Normalize Volume's switch; at once.
    pub fn set_normalize(&self, on: bool) {
        self.player.set_normalize(on);
    }

    /// The outputs the system has, as of a second ago at most; none for a silent engine.
    pub fn outputs(&self) -> Vec<OutputDevice> {
        self.output.outputs()
    }

    /// Plays on the output with `id` while the system has it, and on the system's default
    /// otherwise or with `None`. The song goes on from where it is.
    pub fn set_output(&self, id: Option<String>) {
        self.output.choose(id);
    }

    /// Queues `path` to be measured for Normalize Volume, away from playback; its result comes
    /// back from [take_measurements](Engine::take_measurements) under `id`.
    pub fn measure(&self, path: &Path, id: String) {
        self.measuring.push(path.to_path_buf(), id);
    }

    /// Drops every measurement not done yet: each reports `Cancelled`.
    pub fn cancel_measurements(&self) {
        self.measuring.cancel();
    }

    /// The measurements finished since the last call.
    pub fn take_measurements(&self) -> Vec<(String, Measurement)> {
        self.measuring.take()
    }

    pub fn pause(&self) -> Result<(), EngineError> {
        self.player.pause()
    }

    pub fn seek(&self, position_ms: f64) -> Result<(), EngineError> {
        let rate = self.player.progress().track.ok_or(EngineError::NothingLoaded)?.sample_rate;
        self.player.seek(ms_to_frames(position_ms, rate))
    }

    pub fn status(&self) -> Status {
        let progress = self.player.progress();
        let rate = progress.track.map_or(44_100, |track: TrackInfo| track.sample_rate);
        Status {
            state: progress.state,
            position_ms: frames_to_ms(progress.position_frames, rate),
            duration_ms: progress
                .track
                .and_then(|track| track.duration_frames)
                .map(|frames| frames_to_ms(frames, rate)),
            device: self.output.device(),
            key: self.player.key(),
        }
    }
}

impl Default for Engine {
    fn default() -> Engine {
        Engine::new()
    }
}

/// Measures songs one at a time on a thread of its own, so playback never waits on it.
struct Measuring {
    shared: Arc<MeasureShared>,
    worker: Option<thread::JoinHandle<()>>,
}

struct MeasureShared {
    state: Mutex<MeasureState>,
    wake: Condvar,
    /// Set to stop the measurement under way; cleared as the next one starts.
    cancelled: AtomicBool,
}

#[derive(Default)]
struct MeasureState {
    queue: VecDeque<(PathBuf, String)>,
    done: Vec<(String, Measurement)>,
    shutdown: bool,
}

impl MeasureShared {
    fn lock(&self) -> MutexGuard<'_, MeasureState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Measuring {
    fn start() -> Measuring {
        let shared = Arc::new(MeasureShared {
            state: Mutex::new(MeasureState::default()),
            wake: Condvar::new(),
            cancelled: AtomicBool::new(false),
        });
        let worker_shared = Arc::clone(&shared);
        let worker = thread::Builder::new()
            .name("wave-measure".into())
            .spawn(move || measure_loop(&worker_shared))
            .expect("starts the measuring thread");
        Measuring { shared, worker: Some(worker) }
    }

    fn push(&self, path: PathBuf, id: String) {
        self.shared.lock().queue.push_back((path, id));
        self.shared.wake.notify_all();
    }

    fn cancel(&self) {
        let mut state = self.shared.lock();
        self.shared.cancelled.store(true, Ordering::SeqCst);
        let waiting: Vec<_> = state.queue.drain(..).collect();
        state.done.extend(waiting.into_iter().map(|(_, id)| (id, Measurement::Cancelled)));
    }

    fn take(&self) -> Vec<(String, Measurement)> {
        std::mem::take(&mut self.shared.lock().done)
    }
}

impl Drop for Measuring {
    fn drop(&mut self) {
        self.shared.lock().shutdown = true;
        self.shared.cancelled.store(true, Ordering::SeqCst);
        self.shared.wake.notify_all();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn measure_loop(shared: &MeasureShared) {
    loop {
        let (path, id) = {
            let mut state = shared.lock();
            loop {
                if state.shutdown {
                    return;
                }
                if let Some(job) = state.queue.pop_front() {
                    shared.cancelled.store(false, Ordering::SeqCst);
                    break job;
                }
                state = shared.wake.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        };
        let result = measure(&path, &shared.cancelled);
        shared.lock().done.push((id, result));
    }
}

fn ms_to_frames(ms: f64, rate: u32) -> u64 {
    if ms.is_finite() && ms > 0.0 { (ms * rate as f64 / 1000.0).round() as u64 } else { 0 }
}

fn frames_to_ms(frames: u64, rate: u32) -> f64 {
    frames as f64 * 1000.0 / rate as f64
}
