//! The engine the app drives: one player on the default output device.

use std::path::Path;
use std::sync::Arc;

use crate::error::EngineError;
use crate::output::Output;
use crate::player::{PlayState, Player, TrackInfo};

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
        let player = Arc::new(Player::new());
        let output = Output::start(Arc::clone(&player), silent);
        Engine { player, output }
    }

    pub fn load(&self, path: &Path) -> Result<Status, EngineError> {
        self.player.load(path)?;
        Ok(self.status())
    }

    pub fn play(&self) -> Result<(), EngineError> {
        self.player.play()
    }

    pub fn load_entry(&self, path: &Path, key: Option<String>) -> Result<Status, EngineError> {
        self.player.load_entry(path, key)?;
        Ok(self.status())
    }
    pub fn preload(&self, next: Option<(&Path, String)>) -> Result<(), EngineError> {
        self.player.preload(next)
    }
    pub fn take_transitions(&self) -> Vec<crate::player::Transition> {
        self.player.take_transitions()
    }
    pub fn set_volume(&self, volume: f32) {
        self.player.set_volume(volume);
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

fn ms_to_frames(ms: f64, rate: u32) -> u64 {
    if ms.is_finite() && ms > 0.0 { (ms * rate as f64 / 1000.0).round() as u64 } else { 0 }
}

fn frames_to_ms(frames: u64, rate: u32) -> f64 {
    frames as f64 * 1000.0 / rate as f64
}
