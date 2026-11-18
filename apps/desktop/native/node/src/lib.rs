//! The engine as a Node addon, loaded by the audio utility process (`src/main/audio/`).
//! A refused call throws an Error whose message starts with its code in brackets, such as
//! `[not-found] can't read the file: …`.

use std::path::Path;

use napi::{Error, Result, Status};
use napi_derive::napi;
use wave_audio::EngineError;
use wave_audio::engine::{Engine, Status as EngineStatus};

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
