//! The engine as a Node addon, loaded by the audio utility process (`src/main/audio/`).
//! A refused call throws an Error whose message starts with its code in brackets, such as
//! `[not-found] can't read the file: …`.

use std::path::Path;

use napi::{Error, Result, Status};
use napi_derive::napi;
use wave_audio::EngineError;
use wave_audio::engine::{Engine, Status as EngineStatus};
use wave_audio::loudness::Measurement;
use wave_audio::player::Next;

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

#[napi]
pub struct AudioEngine {
    engine: Engine,
}

#[napi]
impl AudioEngine {
    /// `silent` keeps time without opening an output device.
    #[napi(constructor)]
    pub fn new(silent: Option<bool>) -> AudioEngine {
        let engine = if silent == Some(true) { Engine::silent() } else { Engine::new() };
        AudioEngine { engine }
    }

    /// Opens `path` for queue entry `key`, paused, at Normalize Volume's `gain_db`.
    #[napi]
    pub fn load(
        &self,
        path: String,
        key: Option<String>,
        gain_db: Option<f64>,
    ) -> Result<PlaybackStatus> {
        self.engine.load_entry(Path::new(&path), key, gain_db).map(Into::into).map_err(refused)
    }

    /// Lines up the next song; `fade` false keeps the move to it gapless (repeat one).
    #[napi]
    pub fn preload(
        &self,
        path: Option<String>,
        key: Option<String>,
        gain_db: Option<f64>,
        fade: Option<bool>,
    ) -> Result<()> {
        let next = path.as_ref().zip(key).map(|(path, key)| Next {
            gain_db,
            fade: fade.unwrap_or(true),
            ..Next::new(Path::new(path), key)
        });
        self.engine.preload(next).map_err(refused)
    }

    #[napi]
    pub fn set_volume(&self, volume: f64) {
        self.engine.set_volume(volume as f32);
    }

    /// Crossfade in seconds, 0 to 15; from the next song on.
    #[napi]
    pub fn set_crossfade(&self, seconds: f64) {
        self.engine.set_crossfade(seconds);
    }

    /// Normalize Volume's switch; at once.
    #[napi]
    pub fn set_normalize(&self, on: bool) {
        self.engine.set_normalize(on);
    }

    /// Queues `path` to be measured for Normalize Volume; the result comes from `measurements`.
    #[napi]
    pub fn measure(&self, path: String, id: String) {
        self.engine.measure(Path::new(&path), id);
    }

    /// Drops every measurement not done yet; each comes back cancelled.
    #[napi]
    pub fn cancel_measurements(&self) {
        self.engine.cancel_measurements();
    }

    #[napi]
    pub fn measurements(&self) -> Vec<LoudnessMeasurement> {
        self.engine
            .take_measurements()
            .into_iter()
            .map(|(id, measurement)| {
                let (loudness, peak) = match measurement {
                    Measurement::Measured { loudness, peak } => (Some(loudness), Some(peak)),
                    _ => (None, None),
                };
                LoudnessMeasurement { id, kind: measurement.kind().to_string(), loudness, peak }
            })
            .collect()
    }

    #[napi]
    pub fn transitions(&self) -> Vec<PlaybackTransition> {
        self.engine
            .take_transitions()
            .into_iter()
            .map(|t| PlaybackTransition {
                key: t.key,
                at_ms: t.at_ms,
                kind: t.kind.as_str().to_string(),
            })
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
    /// The entry moved to; for "fadeEnded", the one that faded out.
    pub key: String,
    pub at_ms: f64,
    /// "gapless", "crossfade" or "fadeEnded".
    pub kind: String,
}

#[napi(object)]
pub struct LoudnessMeasurement {
    pub id: String,
    /// "measured", "unmeasurable", "unreadable" or "cancelled".
    pub kind: String,
    /// Integrated loudness in LUFS, when measured.
    pub loudness: Option<f64>,
    /// Sample peak on a 0–1 scale, when measured.
    pub peak: Option<f64>,
}
