//! The engine as a Node addon, loaded by the audio utility process (`src/main/audio/`).
//! A refused call throws an Error whose message starts with its code in brackets, such as
//! `[not-found] can't read the file: …`.
//!
//! A path `yt:<videoId>` plays a YT Music song. The app hands the engine its address with
//! `openStream`; when the address expires the engine asks again through `streamRequests`, and
//! the app answers with `answerStream`. Addresses and their headers are never logged.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use napi::{Error, Result, Status};
use napi_derive::napi;
use wave_audio::EngineError;
use wave_audio::cache::{AudioCache, DEFAULT_BOUND};
use wave_audio::engine::{Engine, Status as EngineStatus};
use wave_audio::stream::{HttpFetcher, Resolver, StreamAddress, Streams};

#[napi(object)]
pub struct PlaybackStatus {
    /// "idle", "paused", "playing" or "ended".
    pub state: String,
    pub position_ms: f64,
    pub duration_ms: Option<f64>,
    /// The output device's name; absent while the song keeps time without one.
    pub device: Option<String>,
    pub key: Option<String>,
}

impl From<EngineStatus> for PlaybackStatus {
    fn from(status: EngineStatus) -> PlaybackStatus {
        PlaybackStatus {
            state: status.state.as_str().to_string(),
            position_ms: status.position_ms,
            duration_ms: status.duration_ms,
            device: status.device,
            key: status.key,
        }
    }
}

fn refused(error: EngineError) -> Error {
    Error::new(Status::GenericFailure, format!("[{}] {error}", error.code()))
}

/// A YT Music song's address, as the JVM resolved it.
#[napi(object)]
pub struct ResolvedStream {
    pub url: String,
    pub headers: HashMap<String, String>,
    pub itag: u32,
    pub mime_type: String,
    pub content_length: Option<f64>,
}

impl From<ResolvedStream> for StreamAddress {
    fn from(resolved: ResolvedStream) -> StreamAddress {
        StreamAddress {
            url: resolved.url,
            headers: resolved.headers.into_iter().collect(),
            itag: resolved.itag,
            mime_type: resolved.mime_type,
            content_length: resolved
                .content_length
                .filter(|n| n.is_finite() && *n > 0.0)
                .map(|n| n as u64),
        }
    }
}

/// The engine asks the app for a fresh address.
#[napi(object)]
pub struct StreamRequest {
    pub id: u32,
    pub video_id: String,
}

/// How long the engine waits for the app to resolve an address again.
const ANSWER_WAIT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Asked {
    next: u32,
    waiting: Vec<StreamRequest>,
    answers: HashMap<u32, std::result::Result<StreamAddress, String>>,
}

/// Fresh addresses come from the app, which asks the JVM.
#[derive(Default)]
struct AppResolver {
    asked: Mutex<Asked>,
    answered: Condvar,
}

impl AppResolver {
    fn lock(&self) -> std::sync::MutexGuard<'_, Asked> {
        self.asked.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Resolver for AppResolver {
    fn resolve(&self, video_id: &str) -> std::result::Result<StreamAddress, String> {
        let mut asked = self.lock();
        asked.next = asked.next.wrapping_add(1);
        let id = asked.next;
        asked.waiting.push(StreamRequest { id, video_id: video_id.to_owned() });
        let deadline = Instant::now() + ANSWER_WAIT;
        loop {
            if let Some(answer) = asked.answers.remove(&id) {
                return answer;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                asked.waiting.retain(|request| request.id != id);
                return Err("the app didn't answer".into());
            }
            asked = self
                .answered
                .wait_timeout(asked, left)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    }
}

#[napi]
pub struct AudioEngine {
    engine: Engine,
    resolver: Arc<AppResolver>,
}

#[napi]
impl AudioEngine {
    /// `silent` keeps time without opening an output device. `cacheDir` is where YT Music songs
    /// are kept; without it the engine plays files only.
    #[napi(constructor)]
    pub fn new(silent: Option<bool>, cache_dir: Option<String>) -> AudioEngine {
        let resolver = Arc::new(AppResolver::default());
        let streams = cache_dir.map(|dir| {
            Arc::new(Streams::new(
                AudioCache::new(PathBuf::from(dir), DEFAULT_BOUND),
                Arc::new(HttpFetcher::new()),
                Arc::clone(&resolver) as Arc<dyn Resolver>,
            ))
        });
        AudioEngine { engine: Engine::with_streams(silent == Some(true), streams), resolver }
    }

    /// Starts fetching a YT Music song from the address the JVM resolved.
    #[napi]
    pub fn open_stream(&self, video_id: String, address: ResolvedStream) -> Result<()> {
        let streams = self.engine.streams().ok_or_else(|| {
            Error::new(Status::GenericFailure, "[not-found] the engine has no audio cache")
        })?;
        streams.start(&video_id, address.into());
        Ok(())
    }

    /// "cached", "ready", "loading", "failed" or "missing".
    #[napi]
    pub fn stream_state(&self, video_id: String) -> String {
        self.engine
            .streams()
            .map_or("missing", |streams| streams.state(&video_id).as_str())
            .to_string()
    }

    /// Songs whose address expired, for the app to resolve again.
    #[napi]
    pub fn stream_requests(&self) -> Vec<StreamRequest> {
        std::mem::take(&mut self.resolver.lock().waiting)
    }

    /// The fresh address for request `id`, or why there is none.
    #[napi]
    pub fn answer_stream(&self, id: u32, address: Option<ResolvedStream>, error: Option<String>) {
        let answer = address.map(Into::into).ok_or_else(|| error.unwrap_or_default());
        self.resolver.lock().answers.insert(id, answer);
        self.resolver.answered.notify_all();
    }

    #[napi]
    pub fn load(&self, path: String, key: Option<String>) -> Result<PlaybackStatus> {
        self.engine.load_entry(Path::new(&path), key).map(Into::into).map_err(refused)
    }

    #[napi]
    pub fn preload(&self, path: Option<String>, key: Option<String>) -> Result<()> {
        self.engine.preload(path.as_ref().zip(key).map(|(p, k)| (Path::new(p), k))).map_err(refused)
    }
    #[napi]
    pub fn set_volume(&self, volume: f64) {
        self.engine.set_volume(volume as f32);
    }
    #[napi]
    pub fn transitions(&self) -> Vec<PlaybackTransition> {
        self.engine
            .take_transitions()
            .into_iter()
            .map(|t| PlaybackTransition { key: t.key, at_ms: t.at_ms })
            .collect()
    }

    #[napi]
    pub fn play(&self) -> Result<()> {
        self.engine.play().map_err(refused)
    }

    #[napi]
    pub fn pause(&self) -> Result<()> {
        self.engine.pause().map_err(refused)
    }

    #[napi]
    pub fn seek(&self, position_ms: f64) -> Result<()> {
        self.engine.seek(position_ms).map_err(refused)
    }

    #[napi]
    pub fn status(&self) -> PlaybackStatus {
        self.engine.status().into()
    }
}

#[napi(object)]
pub struct PlaybackTransition {
    pub key: String,
    pub at_ms: f64,
}
